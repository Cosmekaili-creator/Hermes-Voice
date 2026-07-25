import { env } from '$env/dynamic/private';
import { CAPABILITY_MATRIX } from './matrix';
import type { ProviderId, SessionMintResponse } from './types';

/**
 * Resolve active voice provider from VOICE_PROVIDER.
 * Default `xai` on unset / invalid. Server-only — never import from client barrels.
 */
export function getActiveProvider(): ProviderId {
	const raw = env.VOICE_PROVIDER?.trim().toLowerCase();
	if (raw === 'openai') return 'openai';
	return 'xai';
}

export type ResolvedSessionConfig = Pick<SessionMintResponse, 'provider' | 'model' | 'voice'>;

/**
 * Resolve non-secret provider/model/voice for mint + browser connect.
 * Env overrides (OPENAI_REALTIME_MODEL / OPENAI_VOICE) stay on the server.
 */
export function resolveSessionConfig(): ResolvedSessionConfig {
	const provider = getActiveProvider();
	const caps = CAPABILITY_MATRIX[provider];

	if (provider === 'openai') {
		const model = env.OPENAI_REALTIME_MODEL?.trim() || caps.defaultModel;
		const voice = env.OPENAI_VOICE?.trim() || caps.defaultVoice;
		return { provider, model, voice };
	}

	return {
		provider,
		model: caps.defaultModel,
		voice: caps.defaultVoice
	};
}

export function getActiveCapabilities() {
	return CAPABILITY_MATRIX[getActiveProvider()];
}
