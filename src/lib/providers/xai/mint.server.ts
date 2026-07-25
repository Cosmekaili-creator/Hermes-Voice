import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { redactForLog } from '$lib/server/logRedact';
import type { EphemeralClientSecret } from '../types';
import { CLIENT_SECRETS_URL, DEFAULT_TTL_SECONDS } from './constants';

export type MintProbeCode = 'missing_key' | 'mint_failed' | 'mint_upstream';

export type MintProbeResult =
	| { ok: true; value: string; expires_at: number }
	| { ok: false; code: MintProbeCode };

/**
 * Core mint — non-throwing. Optional apiKey override is for setup tests only.
 * Never logs XAI_API_KEY or the ephemeral value.
 */
async function mintInternal(apiKeyOverride?: string): Promise<MintProbeResult> {
	const apiKey = apiKeyOverride?.trim() || env.XAI_API_KEY?.trim();
	if (!apiKey) {
		return { ok: false, code: 'missing_key' };
	}

	let upstream: Response;
	try {
		upstream = await fetch(CLIENT_SECRETS_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				expires_after: { seconds: DEFAULT_TTL_SECONDS }
			}),
			signal: AbortSignal.timeout(5_000)
		});
	} catch {
		return { ok: false, code: 'mint_failed' };
	}

	const rawText = await upstream.text().catch(() => '');

	if (!upstream.ok) {
		console.error(`xAI client_secrets HTTP ${upstream.status}: ${redactForLog(rawText)}`);
		return { ok: false, code: 'mint_upstream' };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		console.error('xAI client_secrets: non-JSON body');
		return { ok: false, code: 'mint_failed' };
	}

	const value =
		parsed && typeof parsed === 'object' && 'value' in parsed
			? (parsed as { value: unknown }).value
			: undefined;
	const expiresAt =
		parsed && typeof parsed === 'object' && 'expires_at' in parsed
			? (parsed as { expires_at: unknown }).expires_at
			: undefined;

	if (typeof value !== 'string' || value.length === 0 || typeof expiresAt !== 'number') {
		console.error('xAI client_secrets: invalid response shape');
		return { ok: false, code: 'mint_failed' };
	}

	return { ok: true, value, expires_at: expiresAt };
}

/**
 * Mint an xAI realtime ephemeral client secret.
 * Does not bind session voice/model/tools (session.update on the client).
 * Optional `{ apiKey }` is for server-side setup probes only — `/api/session` must not pass it.
 *
 * Server-only (`.server.ts`) — do not import from client/shared barrels.
 */
export async function mintRealtimeClientSecret(opts?: {
	apiKey?: string;
}): Promise<EphemeralClientSecret> {
	const result = await mintInternal(opts?.apiKey);
	if (!result.ok) {
		if (result.code === 'missing_key') {
			error(500, 'Session mint unavailable');
		}
		error(502, 'Session mint failed');
	}
	return { value: result.value, expires_at: result.expires_at };
}

/**
 * Non-throwing mint probe for setup / owner health.
 * Discards value/expires_at — callers must never return them to the client.
 */
export async function probeMint(apiKey?: string): Promise<{ ok: true } | { ok: false; code: MintProbeCode }> {
	const result = await mintInternal(apiKey);
	if (!result.ok) return { ok: false, code: result.code };
	return { ok: true };
}
