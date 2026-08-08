/** Shared provider-adapter types (client-safe). */

import { MAX_HANDS_FREE_SILENCE_MS, MIN_HANDS_FREE_SILENCE_MS } from '$lib/persona/types';

export type ProviderId = 'xai' | 'openai';

export type ProviderTransport = 'websocket_subprotocol' | 'webrtc';

export type ProviderCapabilities = {
	id: ProviderId;
	pcmRate: number;
	serverVad: boolean;
	tools: boolean;
	defaultModel: string;
	defaultVoice: string;
	mintPath: 'ephemeral_client_secret';
	transport: ProviderTransport;
};

export type EphemeralClientSecret = {
	value: string;
	expires_at: number;
};

/** Non-secret session mint payload returned to the browser. */
export type SessionMintResponse = EphemeralClientSecret & {
	provider: ProviderId;
	model: string;
	voice: string;
};

export type VoiceInfo = {
	id: string;
	name: string;
	description?: string;
	/** BCP-47-ish language tag from the provider's catalog, when it supplies one (xAI). */
	language?: string;
	/** Provider-recommended pick — surfaced as a hint in the picker UI, not auto-selected. */
	recommended?: boolean;
};

/** Wire-level turn_detection for realtime session.update (xAI + OpenAI). */
export type WireTurnDetection =
	| null
	| {
			type: 'server_vad';
			/** Silence before end-of-turn (ms). Provider default is often ~500. */
			silence_duration_ms?: number;
			threshold?: number;
			prefix_padding_ms?: number;
			create_response?: boolean;
			interrupt_response?: boolean;
	  }
	| {
			type: 'semantic_vad';
			eagerness?: 'low' | 'medium' | 'high' | 'auto';
			create_response?: boolean;
			interrupt_response?: boolean;
	  };

/** xAI hands-free — silence-based VAD with a longer pause so mid-thought gaps don't steal the turn. */
export const XAI_HANDS_FREE_TURN_DETECTION = {
	type: 'server_vad',
	silence_duration_ms: 1200
} as const satisfies Exclude<WireTurnDetection, null>;

/** OpenAI hands-free — semantic end-of-turn + server-side interrupt for barge-in. */
export const OPENAI_HANDS_FREE_TURN_DETECTION = {
	type: 'semantic_vad',
	eagerness: 'auto',
	create_response: true,
	interrupt_response: true
} as const satisfies Exclude<WireTurnDetection, null>;

/** @deprecated Prefer `handsFreeTurnDetectionFor(provider)` — aliases xAI. */
export const HANDS_FREE_TURN_DETECTION = XAI_HANDS_FREE_TURN_DETECTION;

const DEFAULT_HANDS_FREE_SILENCE_MS = XAI_HANDS_FREE_TURN_DETECTION.silence_duration_ms;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * No override, or an override equal to the default (1200ms), returns the frozen exported
 * const BY IDENTITY (not a copy) — this keeps every existing caller (the default binding,
 * which never sets `handsFreeSilenceMs` away from its 1200ms default) provably untouched.
 *
 * OpenAI's `semantic_vad` has no per-response silence-duration knob (VOICE_PROVIDER is
 * xAI-only for now for this override) — any override is ignored there and the frozen
 * OPENAI_HANDS_FREE_TURN_DETECTION const is always returned by identity.
 */
export function handsFreeTurnDetectionFor(
	provider: ProviderId,
	opts?: { silenceMs?: number }
): Exclude<WireTurnDetection, null> {
	if (provider === 'openai') {
		return OPENAI_HANDS_FREE_TURN_DETECTION;
	}
	const silenceMs = opts?.silenceMs;
	if (silenceMs === undefined || silenceMs === DEFAULT_HANDS_FREE_SILENCE_MS) {
		return XAI_HANDS_FREE_TURN_DETECTION;
	}
	return {
		...XAI_HANDS_FREE_TURN_DETECTION,
		silence_duration_ms: clamp(silenceMs, MIN_HANDS_FREE_SILENCE_MS, MAX_HANDS_FREE_SILENCE_MS)
	};
}

export type RealtimeServerEvent = {
	type: string;
	delta?: string;
	name?: string;
	call_id?: string;
	arguments?: string;
	error?: { message?: string; type?: string; code?: string };
	[key: string]: unknown;
};

export type RealtimeClientHandlers = {
	onEvent?: (event: RealtimeServerEvent) => void;
	onOpen?: () => void;
	onClose?: (ev: CloseEvent) => void;
	onError?: (message: string) => void;
	/** WebRTC remote audio (OpenAI). Ignored by WebSocket clients. */
	onRemoteStream?: (stream: MediaStream) => void;
};

/**
 * Requests user-side speech-to-text from the realtime provider (opt-in memory-review
 * feature — see VoicePersona.reviewConversationForMemory). `languageHint` is wired
 * through but deliberately left unset by every current caller: the app's design mirrors
 * the user's spoken language rather than pinning it from the UI locale, and forcing a
 * hint here would fight that. Left in place for a future caller that wants it.
 */
export type InputTranscription = {
	model: string;
	languageHint?: string;
};

export type RealtimeClientOptions = {
	model?: string;
	voice?: string;
	/** Omit/null → no transcription requested, byte-identical session payload to today. */
	inputTranscription?: InputTranscription | null;
};

/** Optional mic stream for WebRTC connect (shared with Lounge capture). */
export type RealtimeConnectMedia = {
	localStream: MediaStream;
};

export type RealtimeClient = {
	readonly ready: boolean;
	readonly open: boolean;
	/** Mic via MediaStream tracks (WebRTC); PCM `appendAudio` unused. */
	readonly usesMediaTracks: boolean;
	/** Hands-free may barge-in while speaking (browser AEC path). */
	readonly supportsBargeIn: boolean;
	connect(
		token: string,
		instructions: string,
		turnDetection?: WireTurnDetection,
		media?: RealtimeConnectMedia
	): Promise<void>;
	updateInstructions(instructions: string): void;
	setTurnDetection(turnDetection: WireTurnDetection): void;
	send(obj: Record<string, unknown>): void;
	appendAudio(base64Pcm16: string): void;
	commitAndRespond(): void;
	cancelResponse(): void;
	clearInputBuffer(): void;
	sendFunctionCallOutput(callId: string, output: string): void;
	/** Inject a typed user turn as if spoken. Caller triggers `respond()`. */
	sendUserText(text: string): void;
	respond(): void;
	close(): void;
};
