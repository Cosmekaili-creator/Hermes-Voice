/**
 * Voice-layer facade — deep-imports the xAI realtime client (not the xAI barrel).
 * Keeps `TurnDetection` as a stable alias for `WireTurnDetection`.
 */
export {
	createRealtimeClient,
	type RealtimeClient,
	type RealtimeClientHandlers,
	type RealtimeServerEvent,
	type WireTurnDetection
} from '$lib/providers/xai/client';

export type { WireTurnDetection as TurnDetection } from '$lib/providers/xai/client';
