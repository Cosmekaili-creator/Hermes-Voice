/**
 * Voice-layer facade — factory over provider realtime clients.
 * Keeps `TurnDetection` as a stable alias for `WireTurnDetection`.
 */
import { createRealtimeClient as createOpenAIRealtimeClient } from '$lib/providers/openai/client';
import type {
	ProviderId,
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeServerEvent,
	WireTurnDetection
} from '$lib/providers/types';
import { HANDS_FREE_TURN_DETECTION } from '$lib/providers/types';
import { createRealtimeClient as createXaiRealtimeClient } from '$lib/providers/xai/client';

export type {
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeServerEvent,
	WireTurnDetection
};
export type { WireTurnDetection as TurnDetection };
export { HANDS_FREE_TURN_DETECTION };

/** Create a realtime client for the provider returned by `/api/session`. */
export function createRealtimeClientFor(
	provider: ProviderId,
	handlers: RealtimeClientHandlers = {},
	options: RealtimeClientOptions = {}
): RealtimeClient {
	if (provider === 'openai') {
		return createOpenAIRealtimeClient(handlers, options);
	}
	return createXaiRealtimeClient(handlers, options);
}

/** @deprecated Prefer createRealtimeClientFor(provider, …) — defaults to xAI. */
export function createRealtimeClient(
	handlers: RealtimeClientHandlers = {},
	options: RealtimeClientOptions = {}
): RealtimeClient {
	return createXaiRealtimeClient(handlers, options);
}
