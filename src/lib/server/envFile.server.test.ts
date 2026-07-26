import { describe, expect, it } from 'vitest';
import { mergeEnvText } from './envFile.server';

describe('mergeEnvText', () => {
	it('upserts a new key into empty text', () => {
		const out = mergeEnvText('', { VOICE_URL_KEY: 'abc123' });
		expect(out).toBe('VOICE_URL_KEY=abc123\n');
	});

	it('upserts (replaces) an existing key in place, preserving order', () => {
		const existing = 'FOO=bar\nVOICE_URL_KEY=old-value\nBAZ=qux\n';
		const out = mergeEnvText(existing, { VOICE_URL_KEY: 'new-value' });
		expect(out).toBe('FOO=bar\nVOICE_URL_KEY=new-value\nBAZ=qux\n');
	});

	it('removes a key when the update value is null', () => {
		const existing = 'FOO=bar\nVOICE_URL_KEY=old-value\nBAZ=qux\n';
		const out = mergeEnvText(existing, { VOICE_URL_KEY: null });
		expect(out).toBe('FOO=bar\nBAZ=qux\n');
	});

	it('preserves comments and blank lines untouched', () => {
		const existing = '# a comment\n\nFOO=bar\n# another comment\nVOICE_URL_KEY=old\n';
		const out = mergeEnvText(existing, { VOICE_URL_KEY: 'new' });
		expect(out).toBe('# a comment\n\nFOO=bar\n# another comment\nVOICE_URL_KEY=new\n');
	});

	it('quotes values containing whitespace or special characters', () => {
		const out = mergeEnvText('', { HERMES_SESSION_KEY: 'has space' });
		expect(out).toBe('HERMES_SESSION_KEY="has space"\n');
	});

	it('ignores keys with an undefined value in the updates map', () => {
		const existing = 'FOO=bar\n';
		const out = mergeEnvText(existing, { VOICE_URL_KEY: undefined });
		expect(out).toBe('FOO=bar\n');
	});

	it('appends keys that were not already present', () => {
		const existing = 'FOO=bar';
		const out = mergeEnvText(existing, { VOICE_URL_KEY: 'abc' });
		expect(out).toBe('FOO=bar\nVOICE_URL_KEY=abc\n');
	});
});
