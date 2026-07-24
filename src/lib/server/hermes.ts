import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { redactForLog } from '$lib/server/logRedact';

const DEFAULT_BASE = 'http://127.0.0.1:8642';
const HERMES_TIMEOUT_MS = 120_000;

export type HermesChatResult = { text: string };

function hermesBase(): string {
	const raw = env.HERMES_API_BASE?.trim();
	return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_BASE;
}

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

/**
 * Call Hermes Agent OpenAI-compatible chat completions (tools run server-side).
 * Never logs HERMES_API_KEY / HERMES_SESSION_KEY.
 */
export async function callHermesChat(opts: {
	request: string;
	sessionId?: string;
	/** Browser disconnect / user cancel — composed with the 120s timeout. */
	signal?: AbortSignal;
}): Promise<HermesChatResult> {
	const apiKey = env.HERMES_API_KEY?.trim();
	const sessionKey = env.HERMES_SESSION_KEY?.trim();
	if (!apiKey || !sessionKey) {
		error(500, 'Hermes bridge unavailable');
	}

	const request = opts.request.trim();
	if (!request) {
		error(400, 'Missing request');
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		'X-Hermes-Session-Key': sessionKey,
		'Content-Type': 'application/json'
	};
	const sessionId = opts.sessionId?.trim();
	if (sessionId) {
		headers['X-Hermes-Session-Id'] = sessionId.slice(0, 256);
	}

	const url = `${hermesBase()}/v1/chat/completions`;
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
				stream: false,
				messages: [{ role: 'user', content: request }]
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
		console.error(
			`Hermes chat/completions HTTP ${upstream.status}: ${redactForLog(rawText)}`
		);
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
		return { text: 'Hermes returned an empty reply.' };
	}
	return { text };
}
