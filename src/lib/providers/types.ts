/** Shared provider-adapter types (client-safe). */

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

export function handsFreeTurnDetectionFor(provider: ProviderId): Exclude<WireTurnDetection, null> {
	return provider === 'openai' ? OPENAI_HANDS_FREE_TURN_DETECTION : XAI_HANDS_FREE_TURN_DETECTION;
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

export type RealtimeClientOptions = {
	model?: string;
	voice?: string;
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
	respond(): void;
	close(): void;
};
