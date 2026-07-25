/** xAI adapter public surface (client-safe — never re-exports mint). */

export {
	CLIENT_SECRETS_URL,
	DEFAULT_MODEL,
	DEFAULT_TTL_SECONDS,
	DEFAULT_VOICE,
	PCM_RATE,
	REALTIME_URL
} from './constants';
export {
	createRealtimeClient,
	type RealtimeClient,
	type RealtimeClientHandlers,
	type RealtimeServerEvent,
	type WireTurnDetection
} from './client';
export { listVoices } from './voices';
export type { EphemeralClientSecret, VoiceInfo } from '../types';
