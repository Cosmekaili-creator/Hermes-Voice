import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { callHermesChat } from '$lib/server/hermes';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);

	const request =
		body && typeof body === 'object' && 'request' in body
			? String((body as { request?: unknown }).request ?? '').trim()
			: '';
	if (!request) {
		error(400, 'Missing request');
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
