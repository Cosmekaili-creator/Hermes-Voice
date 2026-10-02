import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionSecretCache, sessionSecret } from './sessionSecret.server';

describe('sessionSecret', () => {
	const saved = process.env.SESSION_SECRET;
	afterEach(() => {
		process.env.SESSION_SECRET = saved;
		delete process.env.BINDINGS_FILE;
		resetSessionSecretCache();
	});

	it('creates a persistent 0600 secret next to the bindings file and reuses it', async () => {
		delete process.env.SESSION_SECRET;
		const dir = await mkdtemp(path.join(tmpdir(), 'hv-secret-'));
		process.env.BINDINGS_FILE = path.join(dir, 'bindings.json');
		resetSessionSecretCache();
		const first = sessionSecret();
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		const file = path.join(dir, 'session.secret');
		expect((await readFile(file, 'utf8')).trim()).toBe(first);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		resetSessionSecretCache();
		expect(sessionSecret()).toBe(first);
	});

	it('prefers SESSION_SECRET when it is long enough', () => {
		process.env.SESSION_SECRET = 'x'.repeat(40);
		resetSessionSecretCache();
		expect(sessionSecret()).toBe('x'.repeat(40));
	});
});
