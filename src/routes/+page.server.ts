import type { PageServerLoad } from './$types';
import { getActiveProvider } from '$lib/providers/active.server';
import { grantSessionCookie, resolveBinding } from '$lib/server/auth';
import { getSetupMode } from '$lib/server/setupMode.server';

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

	// All three non-secret: `provider`/`setupMode` are ops-level (not per-user), and
	// setupMode is already exposed unauthenticated via GET /api/setup/status, so this
	// adds no new disclosure. Used by the settings pill/gear (chunk A) and the locked
	// gate's setup-mode-aware guidance.
	return {
		unlocked: binding !== null,
		provider: getActiveProvider(),
		isOwner: binding?.role === 'owner',
		setupMode: getSetupMode()
	};
};
