import type { PageServerLoad } from './$types';
import { grantSessionCookie, resolveBinding } from '$lib/server/auth';

export const load: PageServerLoad = async (event) => {
	const binding = await resolveBinding(event);
	const rawKey = event.url.searchParams.get('k')?.trim();

	// Valid ?k= always unlocks (required for Android/Firefox home-screen shortcuts that
	// keep ?k= in the start URL). Also mint/refresh the HttpOnly session cookie.
	// Do NOT 303-strip ?k= on the server — some PWA/WebView contexts drop the cookie on
	// the redirect follow-up and then land locked on bare `/`.
	if (binding && rawKey) {
		grantSessionCookie(event, binding.voiceKey);
	}

	return { unlocked: binding !== null };
};
