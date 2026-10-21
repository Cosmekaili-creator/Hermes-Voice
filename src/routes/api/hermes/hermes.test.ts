import type { RequestEvent } from '@sveltejs/kit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamHermesChat = vi.hoisted(() => vi.fn(async () => ({ text: 'ok' })));
vi.mock('$lib/server/hermes', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/hermes')>()),
	streamHermesChat
}));

import { POST } from './+server';

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
	const request = new Request(`${ORIGIN}/api/hermes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: JSON.stringify(body)
	});
	return {
		request,
		url: new URL(`${ORIGIN}/api/hermes`),
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
		route: { id: '/api/hermes' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

describe('POST /api/hermes — server-side approval backstop', () => {
	let dir: string;

	beforeEach(async () => {
		streamHermesChat.mockClear();
		dir = await mkdtemp(path.join(tmpdir(), 'hv-hermes-approval-'));
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
		delete process.env.VOICE_APPROVALS_ENFORCE;
	});

	afterEach(async () => {
		for (const k of ['MULTI_USER', 'BINDINGS_FILE', 'VOICE_APPROVALS_ENFORCE'])
			delete process.env[k];
		await rm(dir, { recursive: true, force: true });
	});

	it('answers 409 JSON (not an SSE stream) before Hermes is ever called', async () => {
		const res = await POST(makeEvent({ k: USER_KEY, request: SEND }));
		expect(res.status).toBe(409);
		expect(res.headers.get('content-type')).toContain('application/json');
		const json = (await res.json()) as { code: string; approval: { token: string } };
		expect(json.code).toBe('approval_required');
		expect(json.approval.token).toBeTruthy();
		expect(streamHermesChat).not.toHaveBeenCalled();
	});

	it('streams once the minted token is presented, and not twice', async () => {
		const first = await POST(makeEvent({ k: USER_KEY, request: SEND }));
		const token = ((await first.json()) as { approval: { token: string } }).approval.token;
		const ok = await POST(makeEvent({ k: USER_KEY, request: SEND, approval_token: token }));
		expect(ok.status).toBe(200);
		expect(ok.headers.get('content-type')).toContain('text/event-stream');
		await ok.text();
		expect(streamHermesChat).toHaveBeenCalledTimes(1);
		const reuse = await POST(makeEvent({ k: USER_KEY, request: SEND, approval_token: token }));
		expect(reuse.status).toBe(409);
		expect(((await reuse.json()) as { code: string }).code).toBe('approval_invalid');
	});

	it('streams a lookup for a user and anything for the owner without a token', async () => {
		const lookup = await POST(makeEvent({ k: USER_KEY, request: 'What did Marc send me?' }));
		expect(lookup.status).toBe(200);
		await lookup.text();
		const owner = await POST(makeEvent({ k: OWNER_KEY, request: SEND }));
		expect(owner.status).toBe(200);
		await owner.text();
		expect(streamHermesChat).toHaveBeenCalledTimes(2);
	});
});
