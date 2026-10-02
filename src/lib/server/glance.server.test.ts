import { describe, expect, it } from 'vitest';
import { parseGlance } from './glance.server';

describe('parseGlance', () => {
	it('parses a well-formed reply, even wrapped in prose', () => {
		expect(
			parseGlance('Sure: {"next_event":{"title":"Design review","when":"14:30"},"unread":4}')
		).toEqual({ nextEvent: { title: 'Design review', when: '14:30' }, unread: 4 });
	});

	it('nulls out invalid fields instead of trusting them', () => {
		expect(parseGlance('{"next_event":{"title":""},"unread":-3}')).toEqual({
			nextEvent: null,
			unread: null
		});
		expect(parseGlance('{"next_event":"tomorrow","unread":"lots"}')).toEqual({
			nextEvent: null,
			unread: null
		});
	});

	it('returns null for non-JSON replies', () => {
		expect(parseGlance('I could not check your calendar.')).toBeNull();
	});
});
