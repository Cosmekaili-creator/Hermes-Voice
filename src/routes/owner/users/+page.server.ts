import type { PageServerLoad } from './$types';
import { getActiveProvider } from '$lib/providers/active.server';
import { isOwnerPrincipal, resolveBinding } from '$lib/server/auth';
import { isMultiUserMode } from '$lib/server/bindings.server';

export const load: PageServerLoad = async (event) => {
	const binding = await resolveBinding(event);
	const allowed = isOwnerPrincipal(binding);
	return {
		authenticated: allowed,
		isOwner: allowed,
		multiUser: isMultiUserMode(),
		// Non-secret, ops-level — same value already exposed via +page.server.ts (chunk
		// A7). Used by the per-user VoicePicker (chunk C3): voice ids are scoped to
		// whichever provider is currently active process-wide.
		provider: getActiveProvider()
	};
};
