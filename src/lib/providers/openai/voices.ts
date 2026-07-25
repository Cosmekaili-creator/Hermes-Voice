import type { VoiceInfo } from '../types';
import { DEFAULT_VOICE } from './constants';

/** Static voice catalog stub — unused by Lounge UI. */
export function listVoices(): VoiceInfo[] {
	return [
		{
			id: DEFAULT_VOICE,
			name: 'Alloy',
			description: 'OpenAI realtime default voice'
		},
		{ id: 'ash', name: 'Ash' },
		{ id: 'ballad', name: 'Ballad' },
		{ id: 'coral', name: 'Coral' },
		{ id: 'echo', name: 'Echo' },
		{ id: 'sage', name: 'Sage' },
		{ id: 'shimmer', name: 'Shimmer' },
		{ id: 'verse', name: 'Verse' }
	];
}
