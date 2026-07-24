import type { Handle } from '@sveltejs/kit';

function setSecurityHeaders(response: Response): void {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	// Allow microphone for this app (do not deny microphone=() on the reverse proxy either)
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(self), geolocation=()'
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	setSecurityHeaders(response);
	return response;
};
