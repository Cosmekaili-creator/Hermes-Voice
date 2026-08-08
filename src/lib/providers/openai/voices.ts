import type { VoiceInfo } from '../types';
import { DEFAULT_VOICE } from './constants';

/**
 * Static, hand-maintained voice catalog — OpenAI has no API that enumerates Realtime
 * voices (`GET /v1/models` carries no voice metadata, and no dedicated endpoint
 * exists), so this list is manually kept in sync with OpenAI's docs. Check
 * https://developers.openai.com/api/docs/guides/realtime-conversations periodically
 * for roster changes. `marin`/`cedar` are OpenAI's own recommended picks for quality;
 * all voices are documented as "optimized for English" with no per-voice language
 * breakdown, hence no `language` tag here (see xai/voices.server.ts for the
 * language-tagged xAI equivalent).
 */
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
		{ id: 'verse', name: 'Verse' },
		{ id: 'marin', name: 'Marin', recommended: true },
		{ id: 'cedar', name: 'Cedar', recommended: true }
	];
}
