import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PERSONA,
	MAX_HANDS_FREE_SILENCE_MS,
	MAX_PERSONA_NAME_CHARS,
	MIN_HANDS_FREE_SILENCE_MS,
	mergePersonaPatch,
	normalizePersona,
	normalizeVoiceId,
	type VoicePersona
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
			defaultTalkMode: 'sometimes',
			reviewConversationForMemory: 'yes',
			voiceId: 42
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
			defaultTalkMode: 'handsfree',
			reviewConversationForMemory: true,
			voiceId: 'nova-voice'
		});
		expect(result).toEqual({
			assistantName: 'Nova',
			addressName: 'Alex',
			formalAddress: true,
			patientSilence: true,
			autoGreet: true,
			handsFreeSilenceMs: 4500,
			defaultTalkMode: 'handsfree',
			reviewConversationForMemory: true,
			voiceId: 'nova-voice'
		});
	});

	describe('reviewConversationForMemory', () => {
		it('defaults to false when absent', () => {
			expect(normalizePersona({}).reviewConversationForMemory).toBe(false);
		});

		it('accepts an explicit true', () => {
			expect(
				normalizePersona({ reviewConversationForMemory: true }).reviewConversationForMemory
			).toBe(true);
		});

		it('falls back to false for a non-boolean value', () => {
			expect(
				normalizePersona({ reviewConversationForMemory: 'true' }).reviewConversationForMemory
			).toBe(false);
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

	describe('voiceId', () => {
		it('defaults to null when absent', () => {
			expect(normalizePersona({}).voiceId).toBeNull();
		});

		it('accepts a plain voice id', () => {
			expect(normalizePersona({ voiceId: 'eve' }).voiceId).toBe('eve');
		});
	});
});

describe('normalizeVoiceId', () => {
	it('lowercases uppercase input', () => {
		expect(normalizeVoiceId('EVE')).toBe('eve');
		expect(normalizeVoiceId('Marin-Voice')).toBe('marin-voice');
	});

	it('strips non-newline control characters and accepts the cleaned result', () => {
		const dirty = 'ev' + String.fromCharCode(27) + 'e';
		expect(normalizeVoiceId(dirty)).toBe('eve');
	});

	it('rejects embedded \\n outright — not silently stripped-and-passed', () => {
		expect(normalizeVoiceId('eve\nXAI_API_KEY=evil')).toBeNull();
	});

	it('rejects embedded \\r outright — not silently stripped-and-passed', () => {
		expect(normalizeVoiceId('eve\rXAI_API_KEY=evil')).toBeNull();
	});

	it('rejects a leading dot or hyphen per the regex', () => {
		expect(normalizeVoiceId('.eve')).toBeNull();
		expect(normalizeVoiceId('-eve')).toBeNull();
	});

	it('accepts up to the 64-char boundary and rejects beyond it', () => {
		const ok = 'a'.repeat(64);
		const tooLong = 'a'.repeat(65);
		expect(normalizeVoiceId(ok)).toBe(ok);
		expect(normalizeVoiceId(tooLong)).toBeNull();
	});

	it('rejects an empty string', () => {
		expect(normalizeVoiceId('')).toBeNull();
		expect(normalizeVoiceId('   ')).toBeNull();
	});

	it('rejects non-string input', () => {
		expect(normalizeVoiceId(42)).toBeNull();
		expect(normalizeVoiceId(null)).toBeNull();
		expect(normalizeVoiceId(undefined)).toBeNull();
		expect(normalizeVoiceId(true)).toBeNull();
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeVoiceId('  eve  ')).toBe('eve');
	});
});

describe('mergePersonaPatch', () => {
	const current: VoicePersona = {
		assistantName: 'Nova',
		addressName: 'Alex',
		formalAddress: true,
		patientSilence: true,
		autoGreet: true,
		handsFreeSilenceMs: 4500,
		defaultTalkMode: 'handsfree',
		reviewConversationForMemory: true,
		voiceId: 'nova-voice'
	};

	it('a single-field patch leaves every other field exactly as current had them', () => {
		const result = mergePersonaPatch(current, { autoGreet: false });
		expect(result).toEqual({ ...current, autoGreet: false });
	});

	it('an unknown key in the body is ignored', () => {
		const result = mergePersonaPatch(current, { notARealField: 'whatever' });
		expect(result).toEqual(current);
	});

	it('a garbage-typed known key falls back to current, not DEFAULT_PERSONA', () => {
		const result = mergePersonaPatch(current, { handsFreeSilenceMs: 'not-a-number' });
		expect(result.handsFreeSilenceMs).toBe(current.handsFreeSilenceMs);
		expect(result.handsFreeSilenceMs).not.toBe(DEFAULT_PERSONA.handsFreeSilenceMs);
	});

	it('non-object body leaves every field unchanged', () => {
		expect(mergePersonaPatch(current, null)).toEqual(current);
		expect(mergePersonaPatch(current, 'garbage')).toEqual(current);
		expect(mergePersonaPatch(current, undefined)).toEqual(current);
	});

	it('updates only the present, validly-typed fields', () => {
		const result = mergePersonaPatch(current, {
			assistantName: 'Hermes',
			handsFreeSilenceMs: 2000
		});
		expect(result).toEqual({ ...current, assistantName: 'Hermes', handsFreeSilenceMs: 2000 });
	});

	it('an explicit null for defaultTalkMode/voiceId clears the override (valid per type)', () => {
		const result = mergePersonaPatch(current, { defaultTalkMode: null, voiceId: null });
		expect(result.defaultTalkMode).toBeNull();
		expect(result.voiceId).toBeNull();
	});

	it('a garbage-typed voiceId falls back to current rather than clearing it', () => {
		const result = mergePersonaPatch(current, { voiceId: 'has invalid chars!!' });
		expect(result.voiceId).toBe(current.voiceId);
	});
});
