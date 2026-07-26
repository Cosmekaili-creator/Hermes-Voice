/**
 * Client-safe provider barrel.
 * Never import `$env/dynamic/private` here — use `active.server.ts` for VOICE_PROVIDER.
 */

export type {
	EphemeralClientSecret,
	ProviderCapabilities,
	ProviderId,
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeServerEvent,
	SessionMintResponse,
	VoiceInfo,
	WireTurnDetection
} from './types';
export {
	HANDS_FREE_TURN_DETECTION,
	handsFreeTurnDetectionFor,
	OPENAI_HANDS_FREE_TURN_DETECTION,
	XAI_HANDS_FREE_TURN_DETECTION
} from './types';
export { CAPABILITY_MATRIX } from './matrix';
export { PCM_RATE } from './pcm';
