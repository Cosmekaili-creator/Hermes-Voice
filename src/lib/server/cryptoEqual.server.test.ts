import { describe, expect, it } from 'vitest';
import { safeEqualStr } from './cryptoEqual.server';

describe('safeEqualStr', () => {
	it('returns true for equal strings', () => {
		expect(safeEqualStr('same-secret', 'same-secret')).toBe(true);
		expect(safeEqualStr('', '')).toBe(true);
	});

	it('returns false for unequal strings', () => {
		expect(safeEqualStr('secret-a', 'secret-b')).toBe(false);
		expect(safeEqualStr('short', 'a-much-longer-string')).toBe(false);
		expect(safeEqualStr('secret', '')).toBe(false);
	});

	it('is case sensitive', () => {
		expect(safeEqualStr('Secret', 'secret')).toBe(false);
	});
});
