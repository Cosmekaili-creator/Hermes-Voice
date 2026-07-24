import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { mintRealtimeClientSecret } from '$lib/server/xai';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	requireVoiceKey(event, body);

	const token = await mintRealtimeClientSecret();
	return json({ value: token.value, expires_at: token.expires_at });
};
