/** OpenAI realtime constants (client-safe). */

export const DEFAULT_MODEL = 'gpt-realtime';
export const DEFAULT_VOICE = 'alloy';

/**
 * Opt-in user-side transcription model (see VoicePersona.reviewConversationForMemory).
 * OpenAI's realtime `session.audio.input.transcription` schema may differ slightly from
 * xAI's — if it does, the feature degrades to an assistant-only transcript on OpenAI
 * rather than breaking the session; see the comment in client.ts.
 */
export const DEFAULT_INPUT_TRANSCRIPTION_MODEL = 'whisper-1';

export const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
/** Browser WebRTC SDP exchange (ephemeral Bearer). */
export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
export const DEFAULT_TTL_SECONDS = 300;
