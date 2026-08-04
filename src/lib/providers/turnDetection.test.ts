import { describe, expect, it } from 'vitest';
import { MAX_HANDS_FREE_SILENCE_MS, MIN_HANDS_FREE_SILENCE_MS } from '$lib/persona/types';
import {
	handsFreeTurnDetectionFor,
	OPENAI_HANDS_FREE_TURN_DETECTION,
	XAI_HANDS_FREE_TURN_DETECTION
} from './types';

describe('handsFreeTurnDetectionFor', () => {
	it('uses semantic_vad for OpenAI', () => {
		expect(handsFreeTurnDetectionFor('openai')).toEqual(OPENAI_HANDS_FREE_TURN_DETECTION);
		expect(handsFreeTurnDetectionFor('openai').type).toBe('semantic_vad');
	});

	it('uses server_vad with 1200ms silence for xAI', () => {
		expect(handsFreeTurnDetectionFor('xai')).toEqual(XAI_HANDS_FREE_TURN_DETECTION);
		expect(handsFreeTurnDetectionFor('xai')).toMatchObject({
			type: 'server_vad',
			silence_duration_ms: 1200
		});
	});

	it('xAI: no-opts call returns the frozen const BY REFERENCE (default-binding regression lock)', () => {
		expect(handsFreeTurnDetectionFor('xai')).toBe(XAI_HANDS_FREE_TURN_DETECTION);
	});

	it('xAI: {silenceMs: 1200} (the default) also returns the frozen const BY REFERENCE', () => {
		expect(handsFreeTurnDetectionFor('xai', { silenceMs: 1200 })).toBe(
			XAI_HANDS_FREE_TURN_DETECTION
		);
	});

	it('xAI: a non-default override returns silence_duration_ms in the result without mutating the const', () => {
		const before = { ...XAI_HANDS_FREE_TURN_DETECTION };
		const result = handsFreeTurnDetectionFor('xai', { silenceMs: 4500 });
		expect(result).not.toBe(XAI_HANDS_FREE_TURN_DETECTION);
		expect(result).toMatchObject({ type: 'server_vad', silence_duration_ms: 4500 });
		expect(XAI_HANDS_FREE_TURN_DETECTION).toEqual(before);
	});

	it('xAI: clamps an override below the minimum', () => {
		const result = handsFreeTurnDetectionFor('xai', { silenceMs: 1 });
		expect(result).toMatchObject({ silence_duration_ms: MIN_HANDS_FREE_SILENCE_MS });
	});

	it('xAI: clamps an override above the maximum', () => {
		const result = handsFreeTurnDetectionFor('xai', { silenceMs: 999_999 });
		expect(result).toMatchObject({ silence_duration_ms: MAX_HANDS_FREE_SILENCE_MS });
	});

	it('OpenAI: any override still returns the frozen const unchanged, BY REFERENCE', () => {
		expect(handsFreeTurnDetectionFor('openai', { silenceMs: 4500 })).toBe(
			OPENAI_HANDS_FREE_TURN_DETECTION
		);
	});
});
