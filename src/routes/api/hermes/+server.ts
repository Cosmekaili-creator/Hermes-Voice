import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { callHermesChat, MAX_HERMES_REQUEST_CHARS } from '$lib/server/hermes';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'hermes', RATE.hermes.limit, RATE.hermes.windowMs, binding.id);

	const request =
		body && typeof body === 'object' && 'request' in body
			? String((body as { request?: unknown }).request ?? '').trim()
			: '';
	if (!request) {
		error(400, 'Missing request');
	}
	if (request.length > MAX_HERMES_REQUEST_CHARS) {
		error(400, 'Request too large');
	}

	const sessionId =
		body && typeof body === 'object' && 'session_id' in body
			? String((body as { session_id?: unknown }).session_id ?? '').trim() || undefined
			: undefined;

	const { text } = await callHermesChat({
		request,
		sessionId,
		signal: event.request.signal,
		hermesApiBase: binding.hermesApiBase,
		hermesApiKey: binding.hermesApiKey,
		hermesSessionKey: binding.hermesSessionKey
	});
	return json({ text });
};
