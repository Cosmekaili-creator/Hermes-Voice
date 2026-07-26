import type { Handle } from '@sveltejs/kit';
import { resolveBinding } from '$lib/server/auth';
import { LOCALE_COOKIE, resolveRequestLocale } from '$lib/i18n/resolve';

function setSecurityHeaders(response: Response): void {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	// Allow microphone for this app (do not deny microphone=() on the reverse proxy either)
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.locale = resolveRequestLocale(
		event.cookies.get(LOCALE_COOKIE),
		event.request.headers.get('accept-language')
	);

	const binding = await resolveBinding(event);
	event.locals.principal = binding
		? { id: binding.id, role: binding.role, label: binding.label }
		: null;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.locale)
	});
	setSecurityHeaders(response);
	return response;
};
