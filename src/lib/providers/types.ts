/** Shared provider-adapter types (client-safe). */

export type ProviderId = 'xai' | 'openai';

export type ProviderCapabilities = {
	id: ProviderId;
	pcmRate: number;
	serverVad: boolean;
	tools: boolean;
	defaultModel: string;
	defaultVoice: string;
	mintPath: 'ephemeral_client_secret';
	transport: 'websocket_subprotocol';
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
	  };

/** Hands-free VAD — longer silence so short pauses mid-thought don't steal the turn. */
export const HANDS_FREE_TURN_DETECTION = {
	type: 'server_vad',
	silence_duration_ms: 1200
} as const satisfies Exclude<WireTurnDetection, null>;

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
};

export type RealtimeClientOptions = {
	model?: string;
	voice?: string;
};

export type RealtimeClient = {
	readonly ready: boolean;
	readonly open: boolean;
	connect(token: string, instructions: string, turnDetection?: WireTurnDetection): Promise<void>;
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
