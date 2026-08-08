import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchXaiVoices } from '$lib/providers/xai/voices.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';

/**
 * Lists xAI's TTS voice catalog for the settings/setup voice picker (chunk B).
 * Server-only: the API key never leaves this handler. The upstream URL is the
 * hardcoded `TTS_VOICES_URL` constant — this route must never accept a caller-supplied
 * base URL, so no `isAllowedHermesHost`/SSRF-allowlist involvement is needed here.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'voiceList', RATE.voiceList.limit, RATE.voiceList.windowMs);

	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);

	const xaiApiKey =
		body && typeof body === 'object' && body !== null && 'xaiApiKey' in body
			? (body as { xaiApiKey?: unknown }).xaiApiKey
			: undefined;
	const key = typeof xaiApiKey === 'string' ? xaiApiKey : undefined;

	const result = await fetchXaiVoices(key);
	if (!result.ok) {
		return json({ ok: false, code: result.code });
	}
	return json({
		ok: true,
		voices: result.voices.map((v) => ({ id: v.id, name: v.name, language: v.language }))
	});
};
