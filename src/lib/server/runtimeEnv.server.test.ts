import { afterEach, describe, expect, it } from 'vitest';
import { readEnvTrimmed } from './runtimeEnv.server';

const TEST_KEY = '__HERMES_VOICE_RUNTIME_ENV_TEST__';

describe('readEnvTrimmed', () => {
	afterEach(() => {
		delete process.env[TEST_KEY];
	});

	it('is process.env-first — a live process.env value wins over a stale/absent snapshot', () => {
		expect(readEnvTrimmed(TEST_KEY)).toBeNull();
		process.env[TEST_KEY] = 'live-value';
		expect(readEnvTrimmed(TEST_KEY)).toBe('live-value');
	});

	it('trims whitespace', () => {
		process.env[TEST_KEY] = '  spaced  ';
		expect(readEnvTrimmed(TEST_KEY)).toBe('spaced');
	});

	it('returns null for an unset key', () => {
		expect(readEnvTrimmed('__HERMES_VOICE_DEFINITELY_UNSET__')).toBeNull();
	});

	it('returns null for an empty/whitespace-only process.env value', () => {
		process.env[TEST_KEY] = '   ';
		expect(readEnvTrimmed(TEST_KEY)).toBeNull();
	});

	it('reflects a value cleared from process.env immediately (hot-apply semantics)', () => {
		process.env[TEST_KEY] = 'set';
		expect(readEnvTrimmed(TEST_KEY)).toBe('set');
		delete process.env[TEST_KEY];
		expect(readEnvTrimmed(TEST_KEY)).toBeNull();
	});
});
