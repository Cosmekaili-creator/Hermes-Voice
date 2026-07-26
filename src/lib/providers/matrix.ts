import {
	DEFAULT_MODEL as OPENAI_DEFAULT_MODEL,
	DEFAULT_VOICE as OPENAI_DEFAULT_VOICE
} from './openai/constants';
import { PCM_RATE } from './pcm';
import type { ProviderCapabilities, ProviderId } from './types';
import {
	DEFAULT_MODEL as XAI_DEFAULT_MODEL,
	DEFAULT_VOICE as XAI_DEFAULT_VOICE
} from './xai/constants';

/** Capability matrix — one row per supported realtime provider. */
export const CAPABILITY_MATRIX: Record<ProviderId, ProviderCapabilities> = {
	xai: {
		id: 'xai',
		pcmRate: PCM_RATE,
		serverVad: true,
		tools: true,
		defaultModel: XAI_DEFAULT_MODEL,
		defaultVoice: XAI_DEFAULT_VOICE,
		mintPath: 'ephemeral_client_secret',
		transport: 'websocket_subprotocol'
	},
	openai: {
		id: 'openai',
		pcmRate: PCM_RATE,
		serverVad: true,
		tools: true,
		defaultModel: OPENAI_DEFAULT_MODEL,
		defaultVoice: OPENAI_DEFAULT_VOICE,
		mintPath: 'ephemeral_client_secret',
		transport: 'webrtc'
	}
};
