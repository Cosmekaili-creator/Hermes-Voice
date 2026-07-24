import type { PageServerLoad } from './$types';
import {
	grantSessionCookie,
	isValidSessionCookie,
	isValidVoiceKey
} from '$lib/server/auth';

export const load: PageServerLoad = (event) => {
	const k = event.url.searchParams.get('k');
	const keyOk = isValidVoiceKey(k);
	const cookieOk = isValidSessionCookie(event);

	// Valid ?k= always unlocks (required for Android/Firefox home-screen shortcuts that
	// keep ?k= in the start URL). Also mint/refresh the HttpOnly session cookie.
	// Do NOT 303-strip ?k= on the server — some PWA/WebView contexts drop the cookie on
	// the redirect follow-up and then land locked on bare `/`.
	if (keyOk) {
		grantSessionCookie(event);
	}

	return { unlocked: keyOk || cookieOk };
};
