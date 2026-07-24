import { json, type RequestHandler } from '@sveltejs/kit';

/** Unauthenticated liveness probe — do not call requireVoiceKey (DESIGN/PLAN exemption). */
export const GET: RequestHandler = async () => {
	return json({ ok: true, service: 'hermes-voice' });
};
