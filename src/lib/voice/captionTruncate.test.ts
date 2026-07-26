import { describe, expect, it } from 'vitest';
import { formatHermesToolActivity, truncateSnippet } from './captionTruncate';

describe('truncateSnippet', () => {
	it('returns short text unchanged', () => {
		expect(truncateSnippet('check mail')).toBe('check mail');
	});

	it('collapses whitespace and truncates with ellipsis', () => {
		const long = 'a'.repeat(80);
		expect(truncateSnippet(long, 10)).toBe(`${'a'.repeat(9)}…`);
		expect(truncateSnippet('hello   world\nagain', 64)).toBe('hello world again');
	});
});

describe('formatHermesToolActivity', () => {
	it('prefers label over tool id', () => {
		expect(formatHermesToolActivity('web_extract', 'Reading museomarte.org')).toBe(
			'Reading museomarte.org'
		);
	});

	it('humanizes tool id when label missing', () => {
		expect(formatHermesToolActivity('web_search')).toBe('web search');
	});
});
