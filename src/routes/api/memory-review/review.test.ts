import type { RequestEvent } from '@sveltejs/kit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesToolProgress } from '$lib/server/hermes';

type StreamOpts = {
	request: string;
	signal?: AbortSignal;
	onToolProgress?: (p: HermesToolProgress) => void;
};
const streamHermesChat = vi.hoisted(() =>
	vi.fn<(opts: StreamOpts) => Promise<{ text: string }>>(async () => ({ text: 'saved' }))
);
vi.mock('$lib/server/hermes', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/hermes')>()),
	streamHermesChat
}));

import { POST } from './+server';

const ORIGIN = 'http://localhost:5173';
const KEY_A = 'alice-voice-key-0123456789abcdef';
const KEY_B = 'bob-voice-key-0123456789abcdefgh';
const KEY_C = 'carol-voice-key-0123456789abcdefg';

function uniqueIp(): string {
	return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}`;
}

function makeEvent(
	body: unknown,
	opts: { contentLength?: number; ip?: string } = {}
): RequestEvent {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	const headers = new Headers({ 'Content-Type': 'application/json', Origin: ORIGIN });
	if (opts.contentLength !== undefined) headers.set('content-length', String(opts.contentLength));
	const request = new Request(`${ORIGIN}/api/memory-review`, {
		method: 'POST',
		headers,
		body: text
	});
	const ip = opts.ip ?? uniqueIp();
	return {
		request,
		url: new URL(`${ORIGIN}/api/memory-review`),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		getClientAddress: () => ip,
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/memory-review' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

async function call(body: unknown, opts?: { contentLength?: number; ip?: string }) {
	try {
		const res = await POST(makeEvent(body, opts));
		return { status: res.status, json: (await res.json()) as Record<string, unknown> };
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			return { status: (err as { status: number }).status, json: {} };
		}
		throw err;
	}
}

/** Let the detached review run to completion. */
const settle = () => new Promise((r) => setTimeout(r, 20));

let counter = 0;
function transcript(tag = ''): { role: string; text: string }[] {
	counter += 1;
	return [
		{ role: 'user', text: `I love hiking in the Alps ${counter} ${tag}` },
		{ role: 'assistant', text: 'That sounds lovely.' }
	];
}

describe('POST /api/memory-review hardening', () => {
	let dir: string;

	beforeEach(async () => {
		streamHermesChat.mockReset();
		streamHermesChat.mockResolvedValue({ text: 'saved' });
		dir = await mkdtemp(path.join(tmpdir(), 'hv-memreview-'));
		const now = new Date().toISOString();
		const row = (id: string, voiceKey: string) => ({
			id,
			label: id,
			role: 'user',
			voiceKey,
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: 'k',
			hermesSessionKey: 's',
			enabled: true,
			reviewConversationForMemory: true,
			createdAt: now,
			updatedAt: now
		});
		const bindings = path.join(dir, 'bindings.json');
		await writeFile(
			bindings,
			JSON.stringify({
				version: 1,
				users: [row('alice', KEY_A), row('bob', KEY_B), row('carol', KEY_C)]
			})
		);
		process.env.MULTI_USER = '1';
		process.env.BINDINGS_FILE = bindings;
	});

	afterEach(async () => {
		for (const k of [
			'MULTI_USER',
			'BINDINGS_FILE',
			'MEMORY_REVIEW_ALLOWED_TOOLS',
			'MEMORY_REVIEW_TOOL_TRIPWIRE'
		]) {
			delete process.env[k];
		}
		vi.restoreAllMocks();
		await rm(dir, { recursive: true, force: true });
	});

	it('runs a normal review through the streaming Hermes call', async () => {
		const res = await call({ k: KEY_A, transcript: transcript(), session_id: 's1' });
		expect(res.status).toBe(202);
		await settle();
		expect(streamHermesChat).toHaveBeenCalledTimes(1);
		expect(streamHermesChat.mock.calls[0]![0].request).toContain('hiking in the Alps');
	});

	it('413s on an oversized content-length before parsing', async () => {
		const res = await call({ k: KEY_A, transcript: transcript() }, { contentLength: 300_000 });
		expect(res.status).toBe(413);
		await settle();
		expect(streamHermesChat).not.toHaveBeenCalled();
	});

	it('413s on an oversized body that declared no content-length', async () => {
		const big = { k: KEY_A, transcript: [{ role: 'user', text: 'x'.repeat(300_000) }] };
		const res = await call(big);
		expect(res.status).toBe(413);
	});

	it('acknowledges but ignores an identical transcript for the same binding', async () => {
		const t = transcript('dupe');
		expect((await call({ k: KEY_A, transcript: t })).status).toBe(202);
		await settle();
		expect((await call({ k: KEY_A, transcript: t })).status).toBe(202);
		await settle();
		expect(streamHermesChat).toHaveBeenCalledTimes(1);
		// Another binding with the same text is a different principal — it runs.
		expect((await call({ k: KEY_B, transcript: t })).status).toBe(202);
		await settle();
		expect(streamHermesChat).toHaveBeenCalledTimes(2);
	});

	it('enforces the daily ceiling per binding, whatever the client address', async () => {
		const { RATE } = await import('$lib/server/rateLimit.server');
		for (let i = 0; i < RATE.memoryReviewDaily.limit; i++) {
			const res = await call({ k: KEY_C, transcript: transcript('daily') });
			expect(res.status).toBe(202);
		}
		const over = await call({ k: KEY_C, transcript: transcript('daily') });
		expect(over.status).toBe(429);
		await settle();
		expect(streamHermesChat).toHaveBeenCalledTimes(RATE.memoryReviewDaily.limit);
		// Another binding is unaffected.
		expect((await call({ k: KEY_A, transcript: transcript('daily') })).status).toBe(202);
	});

	describe('tool tripwire', () => {
		it('logs a non-memory tool and lets the review finish (default mode)', async () => {
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			let signal: AbortSignal | undefined;
			streamHermesChat.mockImplementation(async (opts) => {
				signal = opts.signal;
				opts.onToolProgress?.({ tool: 'memory' });
				opts.onToolProgress?.({ tool: 'Send-Email!' });
				opts.onToolProgress?.({ tool: 'Send-Email!' });
				return { text: 'done' };
			});
			expect((await call({ k: KEY_A, transcript: transcript() })).status).toBe(202);
			await settle();
			expect(log).toHaveBeenCalledTimes(1);
			expect(log).toHaveBeenCalledWith(
				'hv-memory-review tool_blocked binding=alice tool=send_email_'
			);
			expect(signal?.aborted).toBe(false);
		});

		it('aborts the review when MEMORY_REVIEW_TOOL_TRIPWIRE=abort', async () => {
			process.env.MEMORY_REVIEW_TOOL_TRIPWIRE = 'abort';
			vi.spyOn(console, 'log').mockImplementation(() => {});
			let signal: AbortSignal | undefined;
			streamHermesChat.mockImplementation(async (opts) => {
				signal = opts.signal;
				opts.onToolProgress?.({ tool: 'browser_navigate' });
				return { text: 'done' };
			});
			await call({ k: KEY_A, transcript: transcript() });
			await settle();
			expect(signal?.aborted).toBe(true);
		});

		it('honours MEMORY_REVIEW_ALLOWED_TOOLS', async () => {
			process.env.MEMORY_REVIEW_ALLOWED_TOOLS = 'memory, session_search';
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			streamHermesChat.mockImplementation(async (opts) => {
				opts.onToolProgress?.({ tool: 'session_search' });
				return { text: 'done' };
			});
			await call({ k: KEY_A, transcript: transcript() });
			await settle();
			expect(log).not.toHaveBeenCalled();
		});
	});
});
