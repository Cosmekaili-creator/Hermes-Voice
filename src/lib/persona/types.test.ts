import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PERSONA,
	MAX_HANDS_FREE_SILENCE_MS,
	MAX_PERSONA_NAME_CHARS,
	MIN_HANDS_FREE_SILENCE_MS,
	normalizePersona
} from './types';

describe('normalizePersona', () => {
	it('falls back to DEFAULT_PERSONA for an empty object', () => {
		expect(normalizePersona({})).toEqual(DEFAULT_PERSONA);
	});

	it('falls back to DEFAULT_PERSONA for non-object input', () => {
		expect(normalizePersona(null)).toEqual(DEFAULT_PERSONA);
		expect(normalizePersona(undefined)).toEqual(DEFAULT_PERSONA);
		expect(normalizePersona('garbage')).toEqual(DEFAULT_PERSONA);
		expect(normalizePersona(42)).toEqual(DEFAULT_PERSONA);
	});

	it('falls back per-field on garbage-typed input', () => {
		const result = normalizePersona({
			assistantName: 123,
			addressName: true,
			formalAddress: 'yes',
			patientSilence: 1,
			autoGreet: 'true',
			handsFreeSilenceMs: 'abc',
			defaultTalkMode: 'sometimes'
		});
		expect(result).toEqual(DEFAULT_PERSONA);
	});

	it('accepts a fully-specified persona', () => {
		const result = normalizePersona({
			assistantName: 'Nova',
			addressName: 'Alex',
			formalAddress: true,
			patientSilence: true,
			autoGreet: true,
			handsFreeSilenceMs: 4500,
			defaultTalkMode: 'handsfree'
		});
		expect(result).toEqual({
			assistantName: 'Nova',
			addressName: 'Alex',
			formalAddress: true,
			patientSilence: true,
			autoGreet: true,
			handsFreeSilenceMs: 4500,
			defaultTalkMode: 'handsfree'
		});
	});

	describe('handsFreeSilenceMs', () => {
		it('clamps below the minimum', () => {
			expect(normalizePersona({ handsFreeSilenceMs: 1 }).handsFreeSilenceMs).toBe(
				MIN_HANDS_FREE_SILENCE_MS
			);
			expect(normalizePersona({ handsFreeSilenceMs: 0 }).handsFreeSilenceMs).toBe(
				MIN_HANDS_FREE_SILENCE_MS
			);
			expect(normalizePersona({ handsFreeSilenceMs: -500 }).handsFreeSilenceMs).toBe(
				MIN_HANDS_FREE_SILENCE_MS
			);
		});

		it('clamps above the maximum', () => {
			expect(normalizePersona({ handsFreeSilenceMs: 999_999 }).handsFreeSilenceMs).toBe(
				MAX_HANDS_FREE_SILENCE_MS
			);
		});

		it('rejects NaN and Infinity, falling back to the default', () => {
			expect(normalizePersona({ handsFreeSilenceMs: NaN }).handsFreeSilenceMs).toBe(
				DEFAULT_PERSONA.handsFreeSilenceMs
			);
			expect(normalizePersona({ handsFreeSilenceMs: Infinity }).handsFreeSilenceMs).toBe(
				DEFAULT_PERSONA.handsFreeSilenceMs
			);
			expect(normalizePersona({ handsFreeSilenceMs: -Infinity }).handsFreeSilenceMs).toBe(
				DEFAULT_PERSONA.handsFreeSilenceMs
			);
		});

		it('rounds fractional values', () => {
			expect(normalizePersona({ handsFreeSilenceMs: 1200.6 }).handsFreeSilenceMs).toBe(1201);
		});
	});

	describe('names', () => {
		it('strips control characters', () => {
			const dirty = 'No' + String.fromCharCode(0) + 'v' + String.fromCharCode(27) + 'a';
			const result = normalizePersona({ assistantName: dirty });
			expect(result.assistantName).toBe('Nova');
		});

		it('caps at MAX_PERSONA_NAME_CHARS', () => {
			const long = 'a'.repeat(MAX_PERSONA_NAME_CHARS + 20);
			const result = normalizePersona({ assistantName: long });
			expect(result.assistantName).toHaveLength(MAX_PERSONA_NAME_CHARS);
		});

		it('falls back to the default assistant name for a blank string', () => {
			expect(normalizePersona({ assistantName: '   ' }).assistantName).toBe(
				DEFAULT_PERSONA.assistantName
			);
		});

		it('allows an empty addressName (optional field)', () => {
			expect(normalizePersona({}).addressName).toBe('');
		});
	});

	describe('defaultTalkMode', () => {
		it('accepts ptt and handsfree', () => {
			expect(normalizePersona({ defaultTalkMode: 'ptt' }).defaultTalkMode).toBe('ptt');
			expect(normalizePersona({ defaultTalkMode: 'handsfree' }).defaultTalkMode).toBe('handsfree');
		});

		it('falls back to null when absent or invalid', () => {
			expect(normalizePersona({}).defaultTalkMode).toBeNull();
			expect(normalizePersona({ defaultTalkMode: 'auto' }).defaultTalkMode).toBeNull();
			expect(normalizePersona({ defaultTalkMode: null }).defaultTalkMode).toBeNull();
		});
	});
});
