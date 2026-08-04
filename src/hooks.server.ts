import type { Handle } from '@sveltejs/kit';
import { DEFAULT_PERSONA } from '$lib/persona/types';
import { resolveBinding } from '$lib/server/auth';
import { personaFromBinding } from '$lib/server/bindings.server';
import { LOCALE_COOKIE, resolveRequestLocale } from '$lib/i18n/resolve';

function setSecurityHeaders(response: Response): void {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	// Allow microphone for this app (do not deny microphone=() on the reverse proxy either)
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
}

/** Persona is not a secret, but it's interpolated into an HTML attribute — escape it anyway. */
function escapeHtmlAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.locale = resolveRequestLocale(
		event.cookies.get(LOCALE_COOKIE),
		event.request.headers.get('accept-language')
	);

	const binding = await resolveBinding(event);
	// Unauthenticated (locked gate) requests get DEFAULT_PERSONA — never leak a bound
	// persona's custom name/address before the voice key gate is passed.
	const persona = binding ? personaFromBinding(binding) : DEFAULT_PERSONA;
	event.locals.principal = binding
		? { id: binding.id, role: binding.role, label: binding.label, persona }
		: null;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace('%lang%', event.locals.locale)
				.replace('%hvAppName%', escapeHtmlAttr(persona.assistantName))
	});
	setSecurityHeaders(response);
	return response;
};
