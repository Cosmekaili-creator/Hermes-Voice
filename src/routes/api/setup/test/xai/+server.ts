import { json, type RequestHandler } from '@sveltejs/kit';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';
import { probeXai } from '$lib/server/setupProbes.server';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	requireSetupOrOwner(event, body);

	const xaiApiKey =
		body && typeof body === 'object' && body !== null && 'xaiApiKey' in body
			? (body as { xaiApiKey?: unknown }).xaiApiKey
			: undefined;

	const key = typeof xaiApiKey === 'string' ? xaiApiKey : null;
	const result = await probeXai(key);
	if (!result.ok) {
		return json({ ok: false, code: result.code });
	}
	return json({ ok: true });
};
