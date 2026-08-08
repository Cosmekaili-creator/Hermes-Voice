import { normalizeVoiceId, type VoicePersona } from '$lib/persona/types';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { CAPABILITY_MATRIX } from './matrix';
import type { ProviderId, SessionMintResponse } from './types';

/**
 * Resolve active voice provider from VOICE_PROVIDER.
 * Default `xai` on unset / invalid. Server-only — never import from client barrels.
 * `readEnvTrimmed` is process.env-first so a hot-applied provider switch (see
 * envFile.server.ts's `applyEnvUpdatesInProcess`) takes effect without a restart.
 */
export function getActiveProvider(): ProviderId {
	const raw = readEnvTrimmed('VOICE_PROVIDER')?.toLowerCase();
	if (raw === 'openai') return 'openai';
	return 'xai';
}

export type ResolvedSessionConfig = Pick<SessionMintResponse, 'provider' | 'model' | 'voice'>;

/**
 * Resolve non-secret provider/model/voice for mint + browser connect.
 *
 * Voice precedence: `persona.voiceId` (per-binding override, if non-null) → env override
 * (`XAI_VOICE`/`OPENAI_VOICE`, process.env-first via `readEnvTrimmed` — see chunk D1) →
 * `caps.defaultVoice`. The resolved candidate is always re-validated through
 * `normalizeVoiceId()` before being returned: a hand-edited `bindings.json` row (or a
 * stale env value) must not be able to inject arbitrary text into a realtime
 * `session.update` / `session.audio.output.voice` payload just because it bypassed the
 * `/api/settings/save` route's own validation. On the live box `MULTI_USER=1`, so the
 * env-voice path below is dead code in production — the real, verifiable path is the
 * per-binding `persona.voiceId`; don't validate this feature by testing the env path only.
 *
 * Env overrides (OPENAI_REALTIME_MODEL / OPENAI_VOICE) stay on the server.
 */
export function resolveSessionConfig(persona: VoicePersona): ResolvedSessionConfig {
	const provider = getActiveProvider();
	const caps = CAPABILITY_MATRIX[provider];

	const model =
		provider === 'openai'
			? readEnvTrimmed('OPENAI_REALTIME_MODEL') || caps.defaultModel
			: caps.defaultModel;

	const envVoiceKey = provider === 'openai' ? 'OPENAI_VOICE' : 'XAI_VOICE';
	const candidate = persona.voiceId ?? readEnvTrimmed(envVoiceKey) ?? caps.defaultVoice;
	const voice = normalizeVoiceId(candidate) ?? caps.defaultVoice;

	return { provider, model, voice };
}

export function getActiveCapabilities() {
	return CAPABILITY_MATRIX[getActiveProvider()];
}
