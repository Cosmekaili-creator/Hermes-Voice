import { json, type RequestHandler } from '@sveltejs/kit';
import { grantSessionCookie, resolveBinding } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

/**
 * Exchange a raw voice key for an HttpOnly session cookie.
 * Never returns the key. Used so the SPA need not retain ?k= in JS.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'authExchange', RATE.authExchange.limit, RATE.authExchange.windowMs);

	const body = await event.request.json().catch(() => ({}));
	const binding = await resolveBinding(event, body);
	if (!binding) {
		return json({ ok: false, code: 'unauthorized' }, { status: 401 });
	}

	grantSessionCookie(event, binding.voiceKey);
	return json({ ok: true });
};
