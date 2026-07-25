/** OpenAI realtime constants (client-safe). */

export const DEFAULT_MODEL = 'gpt-realtime';
export const DEFAULT_VOICE = 'alloy';

export const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
export const DEFAULT_TTL_SECONDS = 300;

export function realtimeUrl(model: string): string {
	return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
}
