import { describe, expect, it } from 'vitest';
import { ringBinFor } from './lazicLounge';

describe('ringBinFor', () => {
	it('is mirror-symmetric left/right so the ring is balanced', () => {
		const n = 120;
		for (let i = 1; i < n / 2; i++) {
			expect(ringBinFor(i, n, 256)).toBe(ringBinFor(n - i, n, 256));
		}
	});

	it('runs from bass at the bottom to higher bins at the top, within range', () => {
		expect(ringBinFor(0, 120, 256)).toBe(2);
		const top = ringBinFor(60, 120, 256);
		expect(top).toBeGreaterThan(100);
		expect(top).toBeLessThan(256);
		for (let i = 0; i < 60; i++) {
			expect(ringBinFor(i + 1, 120, 256)).toBeGreaterThanOrEqual(ringBinFor(i, 120, 256));
		}
	});
});
