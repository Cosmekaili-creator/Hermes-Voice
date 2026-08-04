import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { LOCALES } from './types';

function keysWithAssistantToken(messages: Record<string, string>): Set<string> {
	const keys = new Set<string>();
	for (const [key, value] of Object.entries(messages)) {
		if (value.includes('{assistant}')) keys.add(key);
	}
	return keys;
}

describe('locale catalogs', () => {
	it('have an identical key set across en/fr/es', () => {
		const [first, ...rest] = LOCALES;
		const baseline = new Set(Object.keys(catalog[first!]));
		for (const locale of rest) {
			expect(new Set(Object.keys(catalog[locale]))).toEqual(baseline);
		}
	});

	it('use the {assistant} token in an identical set of keys across en/fr/es', () => {
		const [first, ...rest] = LOCALES;
		const baseline = keysWithAssistantToken(catalog[first!]);
		expect(baseline.size).toBeGreaterThan(0);
		for (const locale of rest) {
			expect(keysWithAssistantToken(catalog[locale])).toEqual(baseline);
		}
	});
});
