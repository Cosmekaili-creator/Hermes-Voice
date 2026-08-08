import type { VoiceInfo } from '../types';
import { DEFAULT_VOICE } from './constants';

/**
 * Offline fallback — live list via the voices-listing route (`voices.server.ts` /
 * `POST /api/setup/voices/xai`); used if the live fetch fails or hasn't run yet.
 */
export function listVoices(): VoiceInfo[] {
	return [
		{
			id: DEFAULT_VOICE,
			name: 'Eve',
			description: 'xAI realtime default voice'
		}
	];
}
