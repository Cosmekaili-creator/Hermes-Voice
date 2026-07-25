import type { VoiceInfo } from '../types';
import { DEFAULT_VOICE } from './constants';

/** Static voice catalog stub — unused by Lounge UI in Phase 3. */
export function listVoices(): VoiceInfo[] {
	return [
		{
			id: DEFAULT_VOICE,
			name: 'Eve',
			description: 'xAI realtime default voice'
		}
	];
}
