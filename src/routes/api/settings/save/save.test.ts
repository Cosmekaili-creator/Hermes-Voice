import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';

/**
 * Route-level test for `POST /api/settings/save`, modeled on the harness pattern
 * established by `src/routes/api/setup/restart/restart.test.ts` (construct a fake
 * `RequestEvent`, drive the real exported `POST` handler, real auth/rate-limit/env code
 * paths — no mocking of the route's own logic).
 *
 * This is the direct route-level proof of the fix for the original config-corruption
 * bug: `settingsFields.server.test.ts` only exercises the pure `pickPresentFields`
 * helper in isolation, not the actual early-return-on-no-op-body path, the owner-binding
 * -sync skip, or the real file-write calls this route makes. This file exercises all
 * three for real, against real temp files.
 */

const ENV_KEYS = [
	'VOICE_URL_KEY',
	'MULTI_USER',
	'BINDINGS_FILE',
	'SETUP_COMPLETE',
	'SETUP_TOKEN',
	'ENV_FILE',
	'HERMES_API_BASE',
	'HERMES_API_KEY',
	'HERMES_SESSION_KEY',
	'XAI_API_KEY',
	'VOICE_PROVIDER'
];

const ORIGIN = 'http://localhost:5173';

/** Fresh IP per call — `setupSave`'s rate-limit bucket is a module-level Map shared
 * across every test in this file (and beyond), so any two tests sharing an IP would
 * pollute each other's bucket regardless of what else differs between them. */
function uniqueIp(): string {
	return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}`;
}

function makeEvent(opts: { origin?: string | null; body?: unknown; ip?: string }): RequestEvent {
	const origin = opts.origin === undefined ? ORIGIN : opts.origin;
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (origin) headers.set('Origin', origin);

	const request = new Request(`${ORIGIN}/api/settings/save`, {
		method: 'POST',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}'
	});

	return {
		request,
		url: new URL(`${ORIGIN}/api/settings/save`),
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
		route: { id: '/api/settings/save' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

// A realistic single-user .env — HERMES_SESSION_KEY deliberately NOT the wizard's
// default ('agent:main:voice'), to prove this route's no-op path doesn't depend on
// current values happening to look like fresh-install defaults.
const OWNER_VOICE_KEY = 'owner-key';
const INITIAL_ENV = [
	`VOICE_URL_KEY=${OWNER_VOICE_KEY}`,
	'SETUP_COMPLETE=1',
	'VOICE_PROVIDER=xai',
	'XAI_API_KEY=xai-live-test-key',
	'HERMES_API_BASE=http://127.0.0.1:8642',
	'HERMES_API_KEY=hermes-live-test-key',
	'HERMES_SESSION_KEY=agent:main:voice:testowner',
	''
].join('\n');

describe('POST /api/settings/save', () => {
	let envDir: string;
	let envFilePath: string;

	beforeEach(async () => {
		for (const key of ENV_KEYS) delete process.env[key];
		envDir = await mkdtemp(path.join(tmpdir(), 'hv-settings-save-test-'));
		envFilePath = path.join(envDir, '.env');
		await writeFile(envFilePath, INITIAL_ENV, 'utf8');
		process.env.ENV_FILE = envFilePath;
		process.env.VOICE_URL_KEY = OWNER_VOICE_KEY;
		process.env.SETUP_COMPLETE = '1';
		process.env.VOICE_PROVIDER = 'xai';
		process.env.XAI_API_KEY = 'xai-live-test-key';
		process.env.HERMES_API_BASE = 'http://127.0.0.1:8642';
		process.env.HERMES_API_KEY = 'hermes-live-test-key';
		process.env.HERMES_SESSION_KEY = 'agent:main:voice:testowner';
	});

	afterEach(async () => {
		for (const key of ENV_KEYS) delete process.env[key];
	});

	it('a no-op save (empty fields) leaves the .env file byte-for-byte unchanged — the A5 acceptance test', async () => {
		const before = await readFile(envFilePath);

		const res = await POST(
			makeEvent({ body: { k: OWNER_VOICE_KEY, section: 'hermes', fields: {} } })
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean; restartRequired: boolean };
		expect(json).toEqual({ ok: true, restartRequired: false });

		const after = await readFile(envFilePath);
		expect(Buffer.compare(before, after)).toBe(0);
	});

	it('single-user mode never touches bindings.json (no multi-user sync path)', async () => {
		// Single-user: isMultiUserMode() is false, so the route's ownerSync branch never
		// runs at all. Belt-and-braces check that a no-op save really is a true no-op
		// end-to-end in the mode the live box is NOT running (MULTI_USER unset here).
		const before = await readFile(envFilePath);
		const res = await POST(
			makeEvent({ body: { k: OWNER_VOICE_KEY, section: 'provider', fields: {} } })
		);
		expect(res.status).toBe(200);
		const after = await readFile(envFilePath);
		expect(Buffer.compare(before, after)).toBe(0);
	});

	it('a present field actually changes only that one .env line, byte-diffing the rest untouched', async () => {
		const beforeText = await readFile(envFilePath, 'utf8');

		const res = await POST(
			makeEvent({
				body: {
					k: OWNER_VOICE_KEY,
					section: 'hermes',
					fields: { HERMES_API_BASE: 'http://127.0.0.1:9999' }
				}
			})
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean; restartRequired: boolean };
		expect(json).toEqual({ ok: true, restartRequired: false });

		const afterText = await readFile(envFilePath, 'utf8');
		const beforeLines = beforeText.split('\n');
		const afterLines = afterText.split('\n');
		expect(afterLines.length).toBe(beforeLines.length);

		let changedLines = 0;
		for (let i = 0; i < beforeLines.length; i++) {
			if (beforeLines[i] !== afterLines[i]) {
				changedLines += 1;
				expect(beforeLines[i]).toBe('HERMES_API_BASE=http://127.0.0.1:8642');
				expect(afterLines[i]).toBe('HERMES_API_BASE=http://127.0.0.1:9999');
			}
		}
		expect(changedLines).toBe(1);
	});
});

describe('POST /api/settings/save — multi-user owner-binding sync', () => {
	let envDir: string;
	let envFilePath: string;
	let bindingsFile: string;
	let ownerId: string;
	let initialOwnerUpdatedAt: string;

	beforeEach(async () => {
		for (const key of ENV_KEYS) delete process.env[key];

		envDir = await mkdtemp(path.join(tmpdir(), 'hv-settings-save-mu-test-'));
		envFilePath = path.join(envDir, '.env');
		await writeFile(envFilePath, INITIAL_ENV, 'utf8');

		bindingsFile = path.join(envDir, 'bindings.json');
		ownerId = randomUUID();
		// updatedAt deliberately in the past — if writeBindingsAtomic runs at all (even
		// with unchanged content), the route stamps a fresh `new Date().toISOString()`
		// on the owner row, which this timestamp would visibly differ from.
		initialOwnerUpdatedAt = '2020-01-01T00:00:00.000Z';
		await writeFile(
			bindingsFile,
			JSON.stringify({
				version: 1,
				users: [
					{
						id: ownerId,
						label: 'Owner',
						role: 'owner',
						voiceKey: OWNER_VOICE_KEY,
						hermesApiBase: 'http://127.0.0.1:8642',
						hermesApiKey: 'owner-hermes-key',
						hermesSessionKey: 'agent:main:voice:testowner',
						enabled: true,
						createdAt: initialOwnerUpdatedAt,
						updatedAt: initialOwnerUpdatedAt
					}
				]
			}),
			'utf8'
		);

		process.env.ENV_FILE = envFilePath;
		process.env.MULTI_USER = '1';
		process.env.BINDINGS_FILE = bindingsFile;
		process.env.SETUP_COMPLETE = '1';
		process.env.VOICE_PROVIDER = 'xai';
		process.env.XAI_API_KEY = 'xai-live-test-key';
	});

	afterEach(async () => {
		for (const key of ENV_KEYS) delete process.env[key];
	});

	it('a no-op "provider" section save skips writeBindingsAtomic entirely — owner row updatedAt is untouched', async () => {
		const beforeBindings = await readFile(bindingsFile, 'utf8');

		const res = await POST(
			makeEvent({ body: { k: OWNER_VOICE_KEY, section: 'provider', fields: {} } })
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean; restartRequired: boolean };
		expect(json).toEqual({ ok: true, restartRequired: false });

		const afterBindings = await readFile(bindingsFile, 'utf8');
		// Not just "still has the right owner" — the file must be byte-for-byte
		// unchanged, proving writeBindingsAtomic was genuinely skipped, not called with
		// content that happened to come out the same.
		expect(afterBindings).toBe(beforeBindings);

		const parsed = JSON.parse(afterBindings) as { users: Array<{ id: string; updatedAt: string }> };
		const owner = parsed.users.find((u) => u.id === ownerId);
		expect(owner?.updatedAt).toBe(initialOwnerUpdatedAt);
	});

	it('a no-op "hermes" section save (empty fields) also skips writeBindingsAtomic', async () => {
		const beforeBindings = await readFile(bindingsFile, 'utf8');

		const res = await POST(
			makeEvent({ body: { k: OWNER_VOICE_KEY, section: 'hermes', fields: {} } })
		);
		expect(res.status).toBe(200);

		const afterBindings = await readFile(bindingsFile, 'utf8');
		expect(afterBindings).toBe(beforeBindings);
	});

	it('a present hermes field DOES sync to the owner binding row, bumping updatedAt', async () => {
		const res = await POST(
			makeEvent({
				body: {
					k: OWNER_VOICE_KEY,
					section: 'hermes',
					fields: { HERMES_API_BASE: 'http://127.0.0.1:9999' }
				}
			})
		);
		expect(res.status).toBe(200);

		const afterBindings = JSON.parse(await readFile(bindingsFile, 'utf8')) as {
			users: Array<{ id: string; hermesApiBase: string; updatedAt: string }>;
		};
		const owner = afterBindings.users.find((u) => u.id === ownerId);
		expect(owner?.hermesApiBase).toBe('http://127.0.0.1:9999');
		expect(owner?.updatedAt).not.toBe(initialOwnerUpdatedAt);
	});
});
