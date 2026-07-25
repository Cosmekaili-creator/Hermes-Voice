import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { redactForLog } from '$lib/server/logRedact';
import type { EphemeralClientSecret } from '../types';
import { CLIENT_SECRETS_URL, DEFAULT_TTL_SECONDS } from './constants';

/**
 * Mint an xAI realtime ephemeral client secret.
 * Does not bind session voice/model/tools (session.update on the client).
 * Never logs XAI_API_KEY or the ephemeral value.
 *
 * Server-only (`.server.ts`) — do not import from client/shared barrels.
 */
export async function mintRealtimeClientSecret(): Promise<EphemeralClientSecret> {
	const apiKey = env.XAI_API_KEY;
	if (!apiKey) {
		error(500, 'Session mint unavailable');
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
			})
		});
	} catch {
		error(502, 'Session mint failed');
	}

	const rawText = await upstream.text().catch(() => '');

	if (!upstream.ok) {
		console.error(`xAI client_secrets HTTP ${upstream.status}: ${redactForLog(rawText)}`);
		error(502, 'Session mint failed');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		console.error('xAI client_secrets: non-JSON body');
		error(502, 'Session mint failed');
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
		error(502, 'Session mint failed');
	}

	return { value, expires_at: expiresAt };
}
