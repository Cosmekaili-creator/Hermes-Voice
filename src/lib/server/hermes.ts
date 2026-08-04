import { error } from '@sveltejs/kit';
import { redactForLog } from '$lib/server/logRedact';
import { createSseParseState, pushSseChunk } from '$lib/sseParse';
import { resolveHermesFetchTarget } from '$lib/server/setupProbes.server';

const HERMES_TIMEOUT_MS = 120_000;
/** Cap authenticated Hermes prompt size (chars) — DoS / cost control. */
export const MAX_HERMES_REQUEST_CHARS = 16_000;

/** The one sentinel string for "Hermes returned nothing" — referenced at every call site so
 * wording can never drift into a 4th silent variant (the greeting sanitizer checks against it too). */
export const HERMES_EMPTY_REPLY = 'Hermes returned an empty reply.';

/**
 * Voice bridge hint — Telegram often uses browser tools successfully while the
 * model may pick `web_extract` (Firecrawl) on the API path and fail hard.
 */
const VOICE_HERMES_SYSTEM = [
	'You are handling a request delegated from Hermes Voice.',
	'For reading websites or event pages: prefer browser tools',
	'(browser_navigate, browser_snapshot, clicks) and x_search over web_extract.',
	'If web_extract fails or is unconfigured, immediately retry with the browser — do not give up after one scrape error.',
	'Complete the user’s full intent (e.g. look up details and offer/add calendar) when asked.'
].join(' ');

export type HermesChatResult = { text: string };

export type HermesToolProgress = {
	tool: string;
	label?: string;
	status?: string;
};

function extractAssistantText(parsed: unknown): string {
	if (!parsed || typeof parsed !== 'object') return '';
	const choices = (parsed as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) return '';
	const message = (choices[0] as { message?: unknown })?.message;
	if (!message || typeof message !== 'object') return '';
	const content = (message as { content?: unknown }).content;
	if (typeof content === 'string') return content.trim();
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const part of content) {
			if (typeof part === 'string') {
				parts.push(part);
				continue;
			}
			if (part && typeof part === 'object' && 'text' in part) {
				const t = (part as { text?: unknown }).text;
				if (typeof t === 'string') parts.push(t);
			}
		}
		return parts.join('').trim();
	}
	return '';
}

function extractDeltaContent(parsed: unknown): string {
	if (!parsed || typeof parsed !== 'object') return '';
	const choices = (parsed as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) return '';
	const delta = (choices[0] as { delta?: unknown })?.delta;
	if (!delta || typeof delta !== 'object') return '';
	const content = (delta as { content?: unknown }).content;
	return typeof content === 'string' ? content : '';
}

function parseToolProgress(data: string): HermesToolProgress | null {
	try {
		const parsed = JSON.parse(data) as {
			tool?: unknown;
			name?: unknown;
			label?: unknown;
			status?: unknown;
		};
		const tool =
			(typeof parsed.tool === 'string' && parsed.tool) ||
			(typeof parsed.name === 'string' && parsed.name) ||
			'';
		if (!tool || tool.startsWith('_')) return null;
		return {
			tool,
			label: typeof parsed.label === 'string' ? parsed.label : undefined,
			status: typeof parsed.status === 'string' ? parsed.status : undefined
		};
	} catch {
		return null;
	}
}

async function resolveHermesTarget(opts: {
	hermesApiBase: string;
	hermesApiKey: string;
	hermesSessionKey: string;
	request: string;
}) {
	const apiKey = opts.hermesApiKey.trim();
	const sessionKey = opts.hermesSessionKey.trim();
	if (!apiKey || !sessionKey) {
		error(500, 'Hermes bridge unavailable');
	}
	const target = await resolveHermesFetchTarget(opts.hermesApiBase);
	if (!target.ok) {
		error(500, 'Hermes bridge unavailable');
	}

	const request = opts.request.trim();
	if (!request) {
		error(400, 'Missing request');
	}
	if (request.length > MAX_HERMES_REQUEST_CHARS) {
		error(400, 'Request too large');
	}

	return { apiKey, sessionKey, target, request };
}

function hermesHeaders(opts: {
	apiKey: string;
	sessionKey: string;
	hostHeader?: string;
	sessionId?: string;
}): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${opts.apiKey}`,
		'X-Hermes-Session-Key': opts.sessionKey,
		'Content-Type': 'application/json'
	};
	if (opts.hostHeader) {
		headers.Host = opts.hostHeader;
	}
	const sessionId = opts.sessionId?.trim();
	if (sessionId) {
		headers['X-Hermes-Session-Id'] = sessionId.slice(0, 256);
	}
	return headers;
}

/**
 * Streaming Hermes chat — surfaces `hermes.tool.progress` for Lounge wait UI.
 * Falls back to non-stream JSON if the upstream rejects streaming.
 */
export async function streamHermesChat(opts: {
	request: string;
	sessionId?: string;
	signal?: AbortSignal;
	hermesApiBase: string;
	hermesApiKey: string;
	hermesSessionKey: string;
	onToolProgress?: (progress: HermesToolProgress) => void;
}): Promise<HermesChatResult> {
	const { apiKey, sessionKey, target, request } = await resolveHermesTarget(opts);
	const headers = hermesHeaders({
		apiKey,
		sessionKey,
		hostHeader: target.hostHeader,
		sessionId: opts.sessionId
	});
	const url = `${target.fetchBase}/v1/chat/completions`;
	const timeout = AbortSignal.timeout(HERMES_TIMEOUT_MS);
	const signal =
		opts.signal && typeof AbortSignal.any === 'function'
			? AbortSignal.any([timeout, opts.signal])
			: timeout;

	let upstream: Response;
	try {
		upstream = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: 'hermes-agent',
				stream: true,
				messages: [
					{ role: 'system', content: VOICE_HERMES_SYSTEM },
					{ role: 'user', content: request }
				]
			}),
			signal
		});
	} catch (err) {
		if (opts.signal?.aborted) {
			error(499, 'Cancelled');
		}
		const name = err instanceof Error ? err.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			error(504, 'Hermes timeout');
		}
		error(502, 'Hermes request failed');
	}

	if (!upstream.ok) {
		const rawText = await upstream.text().catch(() => '');
		console.error(`Hermes chat/completions HTTP ${upstream.status}: ${redactForLog(rawText)}`);
		error(502, 'Hermes request failed');
	}

	const contentType = upstream.headers.get('content-type') || '';
	if (!contentType.includes('text/event-stream') || !upstream.body) {
		// Unexpected non-SSE — try JSON body.
		const rawText = await upstream.text().catch(() => '');
		try {
			const parsed = JSON.parse(rawText) as unknown;
			const text = extractAssistantText(parsed);
			return { text: text || HERMES_EMPTY_REPLY };
		} catch {
			console.error('Hermes chat/completions: expected SSE stream');
			error(502, 'Hermes request failed');
		}
	}

	const reader = upstream.body.getReader();
	const decoder = new TextDecoder();
	const state = createSseParseState();
	let assembled = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			for (const frame of pushSseChunk(state, chunk)) {
				if (frame.data === '[DONE]') continue;
				if (frame.event === 'hermes.tool.progress') {
					const progress = parseToolProgress(frame.data);
					if (progress && (!progress.status || progress.status === 'running')) {
						opts.onToolProgress?.(progress);
					}
					continue;
				}
				try {
					const parsed = JSON.parse(frame.data) as unknown;
					assembled += extractDeltaContent(parsed);
				} catch {
					/* ignore non-JSON data frames */
				}
			}
		}
	} catch (err) {
		if (opts.signal?.aborted) {
			error(499, 'Cancelled');
		}
		const name = err instanceof Error ? err.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			error(504, 'Hermes timeout');
		}
		error(502, 'Hermes request failed');
	}

	const text = assembled.trim();
	return { text: text || HERMES_EMPTY_REPLY };
}

/**
 * Non-streaming Hermes chat (setup probes / fallbacks).
 * Credentials required from resolved binding — zero env.HERMES_* reads.
 */
export async function callHermesChat(opts: {
	request: string;
	sessionId?: string;
	signal?: AbortSignal;
	hermesApiBase: string;
	hermesApiKey: string;
	hermesSessionKey: string;
	/** Defaults to the shared HERMES_TIMEOUT_MS — unchanged for the real ask_hermes path. */
	timeoutMs?: number;
	/** Defaults to VOICE_HERMES_SYSTEM. The greeting caller passes a lean override that
	 * forbids browsing/search tools so a short timeout isn't blown on scrape attempts. */
	systemPrompt?: string;
}): Promise<HermesChatResult> {
	const { apiKey, sessionKey, target, request } = await resolveHermesTarget(opts);
	const headers = hermesHeaders({
		apiKey,
		sessionKey,
		hostHeader: target.hostHeader,
		sessionId: opts.sessionId
	});
	const url = `${target.fetchBase}/v1/chat/completions`;
	const timeout = AbortSignal.timeout(opts.timeoutMs ?? HERMES_TIMEOUT_MS);
	const signal =
		opts.signal && typeof AbortSignal.any === 'function'
			? AbortSignal.any([timeout, opts.signal])
			: timeout;
	const systemPrompt = opts.systemPrompt ?? VOICE_HERMES_SYSTEM;

	let upstream: Response;
	try {
		upstream = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: 'hermes-agent',
				stream: false,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: request }
				]
			}),
			signal
		});
	} catch (err) {
		if (opts.signal?.aborted) {
			error(499, 'Cancelled');
		}
		const name = err instanceof Error ? err.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') {
			error(504, 'Hermes timeout');
		}
		error(502, 'Hermes request failed');
	}

	const rawText = await upstream.text().catch(() => '');
	if (!upstream.ok) {
		console.error(`Hermes chat/completions HTTP ${upstream.status}: ${redactForLog(rawText)}`);
		error(502, 'Hermes request failed');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		console.error('Hermes chat/completions: non-JSON body');
		error(502, 'Hermes request failed');
	}

	const text = extractAssistantText(parsed);
	if (!text) {
		return { text: HERMES_EMPTY_REPLY };
	}
	return { text };
}
