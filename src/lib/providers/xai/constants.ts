/** xAI realtime constants (client-safe). */

export const DEFAULT_MODEL = 'grok-voice-latest';
export const DEFAULT_VOICE = 'eve';

/** Sole literal PCM sample-rate definition in the repo. */
export const PCM_RATE = 24000;

export const CLIENT_SECRETS_URL = 'https://api.x.ai/v1/realtime/client_secrets';
export const REALTIME_URL = `wss://api.x.ai/v1/realtime?model=${DEFAULT_MODEL}`;
export const DEFAULT_TTL_SECONDS = 300;
