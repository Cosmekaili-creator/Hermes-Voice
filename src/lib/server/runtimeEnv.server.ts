import { env } from '$env/dynamic/private';

/**
 * `$env/dynamic/private` is a filtered *snapshot* taken at Server.init under adapter-node —
 * not a live view of `process.env`. `applyEnvUpdatesInProcess()` (envFile.server.ts) mutates
 * `process.env` directly so in-app saves can hot-apply without a restart, but that only reaches
 * callers that read `process.env` first. Always prefer this helper over a bare `env.X` read for
 * any key that can change via an in-app save (provider, API keys, Hermes connection, voice ids).
 */
export function readEnvTrimmed(key: string): string | null {
	const fromProcess = process.env[key]?.trim();
	if (fromProcess) return fromProcess;
	const fromSnapshot = env[key]?.trim();
	return fromSnapshot || null;
}
