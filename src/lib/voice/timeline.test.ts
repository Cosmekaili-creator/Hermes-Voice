import { describe, expect, it } from 'vitest';
import {
	exportTimelineText,
	filterEntries,
	reviveEntry,
	type TimelineEntry
} from './timeline.svelte';

describe('reviveEntry (untrusted localStorage)', () => {
	it('accepts valid entries and rejects malformed ones', () => {
		expect(reviveEntry({ id: 'a', at: 1, kind: 'user', text: 'hi', via: 'text' })).toEqual({
			id: 'a',
			at: 1,
			kind: 'user',
			text: 'hi',
			via: 'text'
		});
		expect(reviveEntry({ id: 'a', at: 1, kind: 'user', text: '' })).toBeNull();
		expect(reviveEntry({ id: 'a', at: 1, kind: 'script', text: 'x' })).toBeNull();
		expect(reviveEntry({ at: 1, kind: 'assistant', text: 'x' })).toBeNull();
		expect(reviveEntry('nope')).toBeNull();
	});

	it('re-validates stored cards (no javascript: links survive a reload)', () => {
		const e = reviveEntry({
			id: 'c',
			at: 1,
			kind: 'cards',
			cards: [
				{ type: 'link', title: 'bad', url: 'javascript:alert(1)' },
				{ type: 'note', title: 'ok' }
			]
		});
		expect(e && e.kind === 'cards' ? e.cards.map((c) => c.title) : []).toEqual(['ok']);
	});

	it('turns a pending approval into declined after a reload', () => {
		const e = reviveEntry({
			id: 'p',
			at: 1,
			kind: 'approval',
			approvalId: 'x',
			summary: 's',
			status: 'pending'
		});
		expect(e && e.kind === 'approval' ? e.status : null).toBe('declined');
	});
});

describe('search + export', () => {
	const entries: TimelineEntry[] = [
		{ id: '1', at: Date.UTC(2026, 0, 1, 9, 0), kind: 'user', text: 'Book Thai food', via: 'voice' },
		{ id: '2', at: Date.UTC(2026, 0, 1, 9, 1), kind: 'assistant', text: 'Booked for 8pm.' }
	];

	it('filters case-insensitively', () => {
		expect(filterEntries(entries, 'thai').map((e) => e.id)).toEqual(['1']);
		expect(filterEntries(entries, '  ')).toHaveLength(2);
	});

	it('exports readable text lines', () => {
		expect(exportTimelineText(entries, { you: 'You', assistant: 'Hermes' })).toBe(
			'[2026-01-01 09:00] You: Book Thai food\n[2026-01-01 09:01] Hermes: Booked for 8pm.'
		);
	});
});
