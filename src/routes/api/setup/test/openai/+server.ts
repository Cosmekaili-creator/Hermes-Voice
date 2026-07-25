import { json, type RequestHandler } from '@sveltejs/kit';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';
import { probeOpenAI } from '$lib/server/setupProbes.server';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);

	const openaiApiKey =
		body && typeof body === 'object' && body !== null && 'openaiApiKey' in body
			? (body as { openaiApiKey?: unknown }).openaiApiKey
			: undefined;

	const key = typeof openaiApiKey === 'string' ? openaiApiKey : null;
	const result = await probeOpenAI(key);
	if (!result.ok) {
		return json({ ok: false, code: result.code });
	}
	return json({ ok: true });
};
