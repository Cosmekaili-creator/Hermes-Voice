import { json, type RequestHandler } from '@sveltejs/kit';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';
import { probeHermes } from '$lib/server/setupProbes.server';

function strField(body: unknown, key: string): string | null {
	if (!body || typeof body !== 'object') return null;
	const v = (body as Record<string, unknown>)[key];
	return typeof v === 'string' ? v : null;
}

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	requireSetupOrOwner(event, body);

	const result = await probeHermes({
		hermesApiBase: strField(body, 'hermesApiBase'),
		hermesApiKey: strField(body, 'hermesApiKey')
	});

	if (!result.ok) {
		return json({ ok: false, code: result.code });
	}
	return json({ ok: true });
};
