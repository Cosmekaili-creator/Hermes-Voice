import { describe, expect, it } from 'vitest';
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
});
