import type { RequestEvent } from '@sveltejs/kit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

// Never reach a real Hermes fetch — dispatches here use waitMs: 0 and just queue.
vi.mock('$lib/server/tasks/runner.server', () => ({
	scheduleBinding: () => {},
	abortByTask: new Map()
}));

const ORIGIN = 'http://localhost:5173';
const OWNER_KEY = 'owner-voice-key-0123456789abcdef';
const USER_KEY = 'alice-voice-key-0123456789abcdef';
const SEND = 'Send an email to Bob saying the meeting moved to 3pm';

function uniqueIp(): string {
	return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}`;
}

function makeEvent(body: unknown): RequestEvent {
	const request = new Request(`${ORIGIN}/api/tasks/dispatch`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: JSON.stringify(body)
	});
	return {
		request,
		url: new URL(`${ORIGIN}/api/tasks/dispatch`),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		getClientAddress: uniqueIp,
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/tasks/dispatch' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
	const res = await POST(makeEvent(body));
	return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/tasks/dispatch — server-side approval backstop', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'hv-dispatch-approval-'));
		const now = new Date().toISOString();
		const row = (id: string, role: string, voiceKey: string) => ({
			id,
			label: id,
			role,
			voiceKey,
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: 'k',
			hermesSessionKey: 's',
			enabled: true,
			createdAt: now,
			updatedAt: now
		});
		const bindings = path.join(dir, 'bindings.json');
		await writeFile(
			bindings,
			JSON.stringify({
				version: 1,
				users: [row('owner', 'owner', OWNER_KEY), row('alice', 'user', USER_KEY)]
			})
		);
		process.env.MULTI_USER = '1';
		process.env.BINDINGS_FILE = bindings;
		process.env.TASKS_DIR = path.join(dir, 'tasks');
		delete process.env.VOICE_APPROVALS_ENFORCE;
	});

	afterEach(async () => {
		for (const k of ['MULTI_USER', 'BINDINGS_FILE', 'TASKS_DIR', 'VOICE_APPROVALS_ENFORCE']) {
			delete process.env[k];
		}
		await rm(dir, { recursive: true, force: true });
	});

	it('409s a side-effect brief from a user with a token, then dispatches on retry', async () => {
		const first = await call({ k: USER_KEY, request: SEND, waitMs: 0 });
		expect(first.status).toBe(409);
		expect(first.json.code).toBe('approval_required');
		const approval = first.json.approval as { token: string; expiresAt: number };
		expect(approval.token).toBeTruthy();

		const retry = await call({
			k: USER_KEY,
			request: SEND,
			waitMs: 0,
			approval_token: approval.token
		});
		expect(retry.status).toBe(202);
		expect(retry.json.ok).toBe(true);
		expect(retry.json.mode).toBe('queued');
	});

	it('answers a reused token with approval_invalid and no new token', async () => {
		const first = await call({ k: USER_KEY, request: SEND, waitMs: 0 });
		const token = (first.json.approval as { token: string }).token;
		expect(
			(await call({ k: USER_KEY, request: SEND, waitMs: 0, approval_token: token })).status
		).toBe(202);
		const reuse = await call({ k: USER_KEY, request: SEND, waitMs: 0, approval_token: token });
		expect(reuse.status).toBe(409);
		expect(reuse.json).toEqual({ ok: false, code: 'approval_invalid' });
	});

	it('rejects a token minted for a different brief', async () => {
		const first = await call({ k: USER_KEY, request: SEND, waitMs: 0 });
		const token = (first.json.approval as { token: string }).token;
		const other = await call({
			k: USER_KEY,
			request: 'Delete all my calendar events',
			waitMs: 0,
			approval_token: token
		});
		expect(other.status).toBe(409);
		expect(other.json.code).toBe('approval_invalid');
	});

	it('lets a lookup brief through without a token', async () => {
		const res = await call({ k: USER_KEY, request: 'What did Marc send me yesterday?', waitMs: 0 });
		expect(res.status).toBe(202);
		expect(res.json.approval).toBeUndefined();
	});

	it('409s a lookup brief when the model flagged requires_approval', async () => {
		const res = await call({
			k: USER_KEY,
			request: 'What did Marc send me yesterday?',
			requires_approval: true,
			waitMs: 0
		});
		expect(res.status).toBe(409);
	});

	it('never gates the owner under the default policy', async () => {
		const res = await call({ k: OWNER_KEY, request: SEND, requires_approval: true, waitMs: 0 });
		expect(res.status).toBe(202);
	});

	it('gates the owner under VOICE_APPROVALS_ENFORCE=all and nobody under off', async () => {
		process.env.VOICE_APPROVALS_ENFORCE = 'all';
		expect((await call({ k: OWNER_KEY, request: SEND, waitMs: 0 })).status).toBe(409);
		process.env.VOICE_APPROVALS_ENFORCE = 'off';
		expect((await call({ k: USER_KEY, request: SEND, waitMs: 0 })).status).toBe(202);
	});
});
