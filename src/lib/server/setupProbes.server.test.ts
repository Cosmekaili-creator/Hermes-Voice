import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	configuredHermesTargets,
	probeHermes,
	resolveHermesFetchTarget
} from './setupProbes.server';

describe('Hermes target allowlist', () => {
	beforeEach(() => {
		delete process.env.MULTI_USER;
		delete process.env.HERMES_API_BASE;
		delete process.env.HERMES_ALLOWED_TARGETS;
	});
	afterEach(() => {
		delete process.env.HERMES_API_BASE;
		delete process.env.HERMES_ALLOWED_TARGETS;
		delete process.env.BINDINGS_FILE;
	});

	it('the default base is always configured', async () => {
		expect(await configuredHermesTargets()).toEqual(new Set(['127.0.0.1:8642']));
		const target = await resolveHermesFetchTarget('http://127.0.0.1:8642');
		expect(target.ok).toBe(true);
	});

	it('HERMES_API_BASE replaces the default', async () => {
		process.env.HERMES_API_BASE = 'http://localhost:9000/';
		expect(await configuredHermesTargets()).toEqual(new Set(['127.0.0.1:9000']));
		expect((await resolveHermesFetchTarget('http://127.0.0.1:9000')).ok).toBe(true);
	});

	it('refuses a loopback service that is not a configured Hermes endpoint', async () => {
		expect(await resolveHermesFetchTarget('http://127.0.0.1:6379')).toEqual({
			ok: false,
			code: 'base_not_allowlisted'
		});
	});

	it('host-class failures keep their own code', async () => {
		expect(await resolveHermesFetchTarget('http://8.8.8.8:8642')).toEqual({
			ok: false,
			code: 'base_not_allowed'
		});
	});

	it('HERMES_ALLOWED_TARGETS adds extras (comma-separated host:port, junk ignored)', async () => {
		process.env.HERMES_ALLOWED_TARGETS = ' 127.0.0.1:8643, 10.0.0.9:8650 ,,::::';
		const targets = await configuredHermesTargets();
		expect(targets.has('127.0.0.1:8643')).toBe(true);
		expect(targets.has('10.0.0.9:8650')).toBe(true);
		expect((await resolveHermesFetchTarget('http://127.0.0.1:8643')).ok).toBe(true);
		expect((await resolveHermesFetchTarget('http://10.0.0.9:8650')).ok).toBe(true);
	});

	it('an unsaved probe to an unlisted port returns base_not_allowlisted', async () => {
		const result = await probeHermes({
			hermesApiBase: 'http://127.0.0.1:6379',
			hermesApiKey: 'k'
		});
		expect(result).toEqual({ ok: false, code: 'base_not_allowlisted' });
	});

	it('in multi-user mode every binding row base is configured', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'hv-targets-'));
		const file = path.join(dir, 'bindings.json');
		const now = new Date().toISOString();
		const row = (id: string, role: string, port: number) => ({
			id,
			label: id,
			role,
			voiceKey: `${id}-voice-key-0123456789abcdef`,
			hermesApiBase: `http://127.0.0.1:${port}`,
			hermesApiKey: 'k',
			hermesSessionKey: 's',
			enabled: true,
			createdAt: now,
			updatedAt: now
		});
		await writeFile(
			file,
			JSON.stringify({
				version: 1,
				users: [row('owner', 'owner', 8642), row('alice', 'user', 8644)]
			})
		);
		process.env.MULTI_USER = '1';
		process.env.BINDINGS_FILE = file;
		try {
			expect((await resolveHermesFetchTarget('http://127.0.0.1:8644')).ok).toBe(true);
			expect(await resolveHermesFetchTarget('http://127.0.0.1:8645')).toEqual({
				ok: false,
				code: 'base_not_allowlisted'
			});
		} finally {
			delete process.env.MULTI_USER;
		}
	});
});
