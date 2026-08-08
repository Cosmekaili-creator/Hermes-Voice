import { describe, expect, it } from 'vitest';
import { normalizeSessionKey } from './bindings.server';

describe('normalizeSessionKey', () => {
	it('accepts a plain session key', () => {
		expect(normalizeSessionKey('agent:main:voice')).toBe('agent:main:voice');
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeSessionKey('  agent:main:voice  ')).toBe('agent:main:voice');
	});

	it('rejects embedded \\n outright (env-injection guard)', () => {
		expect(normalizeSessionKey('agent:main\nXAI_API_KEY=evil')).toBeNull();
	});

	it('rejects embedded \\r outright (env-injection guard)', () => {
		expect(normalizeSessionKey('agent:main\rXAI_API_KEY=evil')).toBeNull();
	});

	it('rejects other control characters', () => {
		expect(normalizeSessionKey('agent\x00main')).toBeNull();
	});

	it('rejects an empty or whitespace-only string', () => {
		expect(normalizeSessionKey('')).toBeNull();
		expect(normalizeSessionKey('   ')).toBeNull();
	});

	it('rejects non-string input', () => {
		expect(normalizeSessionKey(42)).toBeNull();
		expect(normalizeSessionKey(null)).toBeNull();
		expect(normalizeSessionKey(undefined)).toBeNull();
	});
});
