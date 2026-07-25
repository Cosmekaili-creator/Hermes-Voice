import { DEFAULT_MODEL, DEFAULT_VOICE, PCM_RATE } from './xai/constants';
import type { ProviderCapabilities, ProviderId } from './types';

/** Capability matrix stub — xAI row only until Phase 6. */
export const CAPABILITY_MATRIX: Record<ProviderId, ProviderCapabilities> = {
	xai: {
		id: 'xai',
		pcmRate: PCM_RATE,
		serverVad: true,
		tools: true,
		defaultModel: DEFAULT_MODEL,
		defaultVoice: DEFAULT_VOICE,
		mintPath: 'ephemeral_client_secret',
		transport: 'websocket_subprotocol'
	}
};
