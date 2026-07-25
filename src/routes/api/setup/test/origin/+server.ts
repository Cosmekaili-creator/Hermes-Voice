import { json, type RequestHandler } from '@sveltejs/kit';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';
import { probeOrigin } from '$lib/server/setupProbes.server';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);

	const origin =
		body && typeof body === 'object' && body !== null && 'origin' in body
			? (body as { origin?: unknown }).origin
			: undefined;

	const result = probeOrigin({
		origin: typeof origin === 'string' ? origin : null,
		requestOrigin: event.url.origin
	});

	return json({ ok: true, warnings: result.warnings });
};
