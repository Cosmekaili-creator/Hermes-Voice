import type { RequestEvent } from '@sveltejs/kit';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';

const ORIGIN = 'http://localhost:5173';
const OWNER_KEY = 'owner-key-for-caption-debug-tests-0123';
const USER_KEY = 'plain-user-key-for-caption-debug-0123';

let n = 0;
function makeEvent(body: unknown): RequestEvent {
	n += 1;
	const request = new Request(`${ORIGIN}/api/debug/captions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: JSON.stringify(body)
	});
	return {
		request,
		url: new URL(`${ORIGIN}/api/debug/captions`),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
		getClientAddress: () => `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`,
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/debug/captions' }
	} as unknown as RequestEvent;
}

async function status(ev: RequestEvent): Promise<number> {
	try {
		return (await POST(ev)).status;
	} catch (err) {
		if (err instanceof Response) return err.status;
		return (err as { status: number }).status;
	}
}

describe('POST /api/debug/captions (M2)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'hv-capdbg-'));
		const bindings = path.join(dir, 'bindings.json');
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
		await writeFile(
			bindings,
			JSON.stringify({
				version: 1,
				users: [row('owner', 'owner', OWNER_KEY), row('alice', 'user', USER_KEY)]
			})
		);
		process.env.MULTI_USER = '1';
		process.env.BINDINGS_FILE = bindings;
		process.env.CAPTION_DEBUG_DIR = path.join(dir, 'debug');
	});

	afterEach(() => {
		for (const k of ['MULTI_USER', 'BINDINGS_FILE', 'CAPTION_DEBUG_DIR', 'CAPTION_DEBUG']) {
			delete process.env[k];
		}
	});

	const events = [{ t: 1, type: 'delta', deltaLen: 4, preview: 'secret words', evil: { x: 1 } }];

	it('is a 404 unless CAPTION_DEBUG=1', async () => {
		expect(await status(makeEvent({ k: OWNER_KEY, events }))).toBe(404);
	});

	it('refuses non-owner users', async () => {
		process.env.CAPTION_DEBUG = '1';
		expect(await status(makeEvent({ k: USER_KEY, events }))).toBe(403);
	});

	it('keeps only allow-listed scalar fields (drops transcript previews), file mode 0600', async () => {
		process.env.CAPTION_DEBUG = '1';
		expect(await status(makeEvent({ k: OWNER_KEY, session: 'cap-1', events }))).toBe(200);
		const file = path.join(dir, 'debug', 'captions.jsonl');
		const line = JSON.parse((await readFile(file, 'utf8')).trim()) as Record<string, unknown>;
		expect(line).toMatchObject({ session: 'cap-1', type: 'delta', deltaLen: 4, t: 1 });
		expect(line).not.toHaveProperty('preview');
		expect(line).not.toHaveProperty('evil');
		expect((await stat(file)).mode & 0o777).toBe(0o600);
	});
});
