import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real scheduleSelfRestart() calls process.kill(process.pid, 'SIGTERM') — invoking
// it for real here would kill the vitest worker process itself. Mock it so the tests
// can assert the handler resolves/returns without actually triggering a restart.
vi.mock('$lib/server/selfRestart.server', () => ({
	scheduleSelfRestart: vi.fn()
}));

import { scheduleSelfRestart } from '$lib/server/selfRestart.server';
import { POST } from './+server';

const ENV_KEYS = [
	'VOICE_URL_KEY',
	'MULTI_USER',
	'BINDINGS_FILE',
	'SETUP_COMPLETE',
	'SETUP_TOKEN',
	'ALLOW_SELF_RESTART'
];

const ORIGIN = 'http://localhost:5173';

/** Fresh IP per call — the rate-limit bucket is a module-level Map shared across every
 * test in this file (and beyond), so any two tests sharing an IP would pollute each
 * other's `setupRestart` bucket regardless of what else differs between them. */
function uniqueIp(): string {
	return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}`;
}

function makeEvent(opts: { origin?: string | null; body?: unknown; ip?: string }): RequestEvent {
	const origin = opts.origin === undefined ? ORIGIN : opts.origin;
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (origin) headers.set('Origin', origin);

	const request = new Request(`${ORIGIN}/api/setup/restart`, {
		method: 'POST',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}'
	});

	return {
		request,
		url: new URL(`${ORIGIN}/api/setup/restart`),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		getClientAddress: () => opts.ip ?? uniqueIp(),
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/setup/restart' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

/** POST throws (via SvelteKit `error()` or a raw Response from enforceRateLimit) rather
 * than returning a Response for auth/rate-limit failures — normalize both to a status. */
async function callAndGetStatus(event: RequestEvent): Promise<number> {
	try {
		const res = await POST(event);
		return res.status;
	} catch (err) {
		if (err instanceof Response) return err.status;
		if (err && typeof err === 'object' && 'status' in err) {
			return (err as { status: number }).status;
		}
		throw err;
	}
}

describe('POST /api/setup/restart', () => {
	beforeEach(() => {
		for (const key of ENV_KEYS) delete process.env[key];
		vi.mocked(scheduleSelfRestart).mockClear();
	});

	afterEach(() => {
		for (const key of ENV_KEYS) delete process.env[key];
	});

	it('403s cross-origin (mismatched Origin header)', async () => {
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		process.env.ALLOW_SELF_RESTART = '1';

		const status = await callAndGetStatus(
			makeEvent({ origin: 'https://evil.example', body: { k: 'test-voice-key' } })
		);
		expect(status).toBe(403);
		expect(scheduleSelfRestart).not.toHaveBeenCalled();
	});

	it('401s for a completely unauthenticated request (no voice key at all)', async () => {
		// Single-user complete mode: no key anywhere → requireVoiceKey's documented
		// contract is 401 Unauthorized (403 Forbidden is reserved for "authenticated but
		// wrong role" — see the multi-user non-owner test below for that case).
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		process.env.ALLOW_SELF_RESTART = '1';

		const status = await callAndGetStatus(makeEvent({ body: {} }));
		expect(status).toBe(401);
		expect(scheduleSelfRestart).not.toHaveBeenCalled();
	});

	it('403s an authenticated non-owner in multi-user mode (same gate as the save routes)', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'hv-restart-test-'));
		const bindingsFile = path.join(dir, 'bindings.json');
		const now = new Date().toISOString();
		await writeFile(
			bindingsFile,
			JSON.stringify({
				version: 1,
				users: [
					{
						id: randomUUID(),
						label: 'Owner',
						role: 'owner',
						voiceKey: 'owner-key',
						hermesApiBase: 'http://127.0.0.1:8642',
						hermesApiKey: 'owner-hermes-key',
						hermesSessionKey: 'agent:main:voice',
						enabled: true,
						createdAt: now,
						updatedAt: now
					},
					{
						id: randomUUID(),
						label: 'Roland',
						role: 'user',
						voiceKey: 'roland-key',
						hermesApiBase: 'http://127.0.0.1:8643',
						hermesApiKey: 'roland-hermes-key',
						hermesSessionKey: 'agent:main:voice',
						enabled: true,
						createdAt: now,
						updatedAt: now
					}
				]
			}),
			'utf8'
		);

		try {
			process.env.MULTI_USER = '1';
			process.env.BINDINGS_FILE = bindingsFile;
			process.env.SETUP_COMPLETE = '1';
			process.env.ALLOW_SELF_RESTART = '1';

			const status = await callAndGetStatus(makeEvent({ body: { k: 'roland-key' } }));
			expect(status).toBe(403);
			expect(scheduleSelfRestart).not.toHaveBeenCalled();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('501s restart_unsupported when ALLOW_SELF_RESTART is unset, even for a valid owner', async () => {
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		// ALLOW_SELF_RESTART deliberately left unset.

		const event = makeEvent({ body: { k: 'test-voice-key' } });
		const res = await POST(event);
		expect(res.status).toBe(501);
		const json = (await res.json()) as { ok: boolean; code?: string };
		expect(json).toEqual({ ok: false, code: 'restart_unsupported' });
		expect(scheduleSelfRestart).not.toHaveBeenCalled();
	});

	it('501s restart_unsupported when ALLOW_SELF_RESTART is set to something other than "1"', async () => {
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		process.env.ALLOW_SELF_RESTART = 'true';

		const res = await POST(makeEvent({ body: { k: 'test-voice-key' } }));
		expect(res.status).toBe(501);
		expect(scheduleSelfRestart).not.toHaveBeenCalled();
	});

	it('a valid owner request with ALLOW_SELF_RESTART=1 resolves ok:true and schedules (mocked) restart', async () => {
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		process.env.ALLOW_SELF_RESTART = '1';

		const res = await POST(makeEvent({ body: { k: 'test-voice-key' } }));
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean };
		expect(json).toEqual({ ok: true });
		// The mocked fn was invoked — proof the handler resolves/returns without the
		// *real* restart side effect ever firing under vitest.
		expect(scheduleSelfRestart).toHaveBeenCalledTimes(1);
	});

	it('429s on the 4th call within the 5-minute window (limit: 3)', async () => {
		process.env.VOICE_URL_KEY = 'test-voice-key';
		process.env.SETUP_COMPLETE = '1';
		process.env.ALLOW_SELF_RESTART = '1';
		const ip = uniqueIp();

		for (let i = 0; i < 3; i++) {
			const res = await POST(makeEvent({ body: { k: 'test-voice-key' }, ip }));
			expect(res.status).toBe(200);
		}

		const fourth = await callAndGetStatus(makeEvent({ body: { k: 'test-voice-key' }, ip }));
		expect(fourth).toBe(429);
		// Exactly 3 real (mocked) restarts scheduled — the 4th never reached that point.
		expect(scheduleSelfRestart).toHaveBeenCalledTimes(3);
	});
});
