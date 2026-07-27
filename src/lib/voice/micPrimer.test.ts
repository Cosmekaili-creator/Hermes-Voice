import { describe, expect, it } from 'vitest';
import { hasMicPrimed } from './micPrimer';

describe('hasMicPrimed', () => {
	it('returns true (never prime) when localStorage is unavailable — the SSR default', () => {
		// The node vitest project has no localStorage global — this is the real default.
		expect(hasMicPrimed()).toBe(true);
	});
});
