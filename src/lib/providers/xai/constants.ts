/** xAI realtime constants (client-safe). */

export { PCM_RATE } from '../pcm';

export const DEFAULT_MODEL = 'grok-voice-latest';
export const DEFAULT_VOICE = 'eve';

/** Opt-in user-side transcription model (see VoicePersona.reviewConversationForMemory). */
export const DEFAULT_INPUT_TRANSCRIPTION_MODEL = 'grok-transcribe';

export const CLIENT_SECRETS_URL = 'https://api.x.ai/v1/realtime/client_secrets';
export const DEFAULT_TTL_SECONDS = 300;

export function realtimeUrl(model: string): string {
	return `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`;
}

/** @deprecated Prefer realtimeUrl(model) — kept for one-release import compatibility. */
export const REALTIME_URL = realtimeUrl(DEFAULT_MODEL);
