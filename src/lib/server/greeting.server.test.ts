import { describe, expect, it } from 'vitest';
import { HERMES_EMPTY_REPLY } from './hermes';
import { buildGreetingPrompt, MAX_GREETING_CHARS, sanitizeGreetingText } from './greeting.server';

describe('buildGreetingPrompt', () => {
	it('contains the address name', () => {
		const prompt = buildGreetingPrompt({
			addressName: 'Alex',
			assistantName: 'Nova',
			locale: 'en'
		});
		expect(prompt).toContain('Alex');
	});

	it('falls back to a generic address when addressName is empty', () => {
		const prompt = buildGreetingPrompt({ addressName: '', assistantName: 'Hermes', locale: 'en' });
		expect(prompt).toContain('the user');
	});
});

describe('sanitizeGreetingText', () => {
	it('returns null for an empty string', () => {
		expect(sanitizeGreetingText('')).toBeNull();
		expect(sanitizeGreetingText('   ')).toBeNull();
	});

	it('returns null for the exact HERMES_EMPTY_REPLY sentinel', () => {
		expect(sanitizeGreetingText(HERMES_EMPTY_REPLY)).toBeNull();
	});

	it('collapses embedded newlines/whitespace to single spaces', () => {
		expect(sanitizeGreetingText('Good\nmorning,   Alex.\n\nHow are you?')).toBe(
			'Good morning, Alex. How are you?'
		);
	});

	it('strips <<< and >>> sequences so a reply can never forge a quarantine marker', () => {
		expect(sanitizeGreetingText('<<<OPENING_LINE>>> Hi >>> there <<<')).toBe(
			'OPENING_LINE Hi there'
		);
	});

	it('truncates at MAX_GREETING_CHARS on a word boundary', () => {
		const long = Array.from({ length: 100 }, () => 'word').join(' ');
		expect(long.length).toBeGreaterThan(MAX_GREETING_CHARS);
		const result = sanitizeGreetingText(long)!;
		expect(result.length).toBeLessThanOrEqual(MAX_GREETING_CHARS);
		// Word-boundary truncation never cuts mid-word.
		expect(long.startsWith(result)).toBe(true);
		expect(long[result.length]).toBe(' ');
	});
});
