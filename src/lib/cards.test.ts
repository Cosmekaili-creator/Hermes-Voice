import { describe, expect, it } from 'vitest';
import { extractCards, sanitizeCards } from './cards';

describe('extractCards', () => {
	it('splits the spoken text from a valid hv-cards block', () => {
		const text =
			'You have two meetings.\n```hv-cards\n[{"type":"event","title":"Design review","when":"14:30"}]\n```';
		const out = extractCards(text);
		expect(out.text).toBe('You have two meetings.');
		expect(out.cards).toEqual([{ type: 'event', title: 'Design review', when: '14:30' }]);
	});

	it('always removes the block from spoken text, even when the JSON is broken', () => {
		const out = extractCards('Done.\n```hv-cards\n[{not json\n```');
		expect(out.text).toBe('Done.');
		expect(out.cards).toEqual([]);
	});

	it('leaves text without a block untouched', () => {
		expect(extractCards('plain answer')).toEqual({ text: 'plain answer', cards: [] });
	});
});

describe('sanitizeCards', () => {
	it('drops non-http(s) links, credentials in URLs, unknown types and missing titles', () => {
		const cards = sanitizeCards([
			{ type: 'link', title: 'ok', url: 'https://example.com/a' },
			{ type: 'link', title: 'js', url: 'javascript:alert(1)' },
			{ type: 'link', title: 'creds', url: 'https://user:pw@example.com' },
			{ type: 'script', title: 'x' },
			{ type: 'note' },
			'nope'
		]);
		expect(cards).toEqual([
			{ type: 'link', title: 'ok', url: 'https://example.com/a', detail: undefined }
		]);
	});

	it('caps the number of cards and the field lengths, and strips control characters', () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ type: 'note', title: `n${i}` }));
		expect(sanitizeCards(many)).toHaveLength(6);
		const [card] = sanitizeCards([{ type: 'note', title: `a\u0000b${'x'.repeat(500)}` }]);
		expect(card!.title.length).toBeLessThanOrEqual(120);
		expect(card!.title).not.toContain('\u0000');
	});
});

describe('extractCards — multiple / truncated blocks', () => {
	it('strips every block and a trailing unterminated one', () => {
		const out = extractCards(
			'A.\n```hv-cards\n[{"type":"note","title":"one"}]\n```\nB.\n```hv-cards\n[{"type":"note","title":"two"}]\n```\nC.\n```hv-cards\n[{"type":"note","ti'
		);
		expect(out.text).not.toContain('hv-cards');
		expect(out.text).not.toContain('{');
		expect(out.cards.map((c) => c.title)).toEqual(['one', 'two']);
	});
});
