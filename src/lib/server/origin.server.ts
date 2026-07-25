import { error, type RequestEvent } from '@sveltejs/kit';

/**
 * Defense-in-depth for JSON mutators (Kit CSRF only covers form content-types).
 * Allow same-origin Origin/Referer, or Sec-Fetch-Site same-origin/same-site/none.
 */
export function assertSameOrigin(event: RequestEvent): void {
	const origin = event.url.origin;
	const reqOrigin = event.request.headers.get('origin');
	if (reqOrigin) {
		if (reqOrigin === origin) return;
		error(403, 'Forbidden origin');
	}

	const site = event.request.headers.get('sec-fetch-site');
	if (site === 'cross-site') {
		error(403, 'Forbidden origin');
	}
	if (site === 'same-origin' || site === 'same-site' || site === 'none') return;

	const referer = event.request.headers.get('referer');
	if (referer) {
		try {
			if (new URL(referer).origin === origin) return;
		} catch {
			/* ignore */
		}
		error(403, 'Forbidden origin');
	}

	// No Origin / Referer / Sec-Fetch-Site — allow (some same-origin WebViews omit them).
}
