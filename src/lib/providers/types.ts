/** Shared provider-adapter types (client-safe). */

export type ProviderId = 'xai';

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

export type VoiceInfo = {
	id: string;
	name: string;
	description?: string;
};

/** Wire-level turn_detection for realtime session.update. */
export type WireTurnDetection = null | { type: 'server_vad' };
