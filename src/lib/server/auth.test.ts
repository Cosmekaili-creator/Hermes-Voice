import { describe, expect, it } from 'vitest';
import { derivedSessionToken } from './auth';

describe('derivedSessionToken', () => {
	it('is stable for the same voice key', () => {
		const a = derivedSessionToken('my-voice-key');
		const b = derivedSessionToken('my-voice-key');
		expect(a).toBe(b);
	});

	it('differs for different voice keys', () => {
		const a = derivedSessionToken('voice-key-a');
		const b = derivedSessionToken('voice-key-b');
		expect(a).not.toBe(b);
	});

	it('never returns the raw voice key', () => {
		const key = 'my-voice-key';
		expect(derivedSessionToken(key)).not.toBe(key);
	});

	it('produces a hex-encoded sha256 HMAC (64 hex chars)', () => {
		expect(derivedSessionToken('anything')).toMatch(/^[0-9a-f]{64}$/);
	});
});
