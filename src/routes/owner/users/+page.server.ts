import type { PageServerLoad } from './$types';
import { isOwnerPrincipal, resolveBinding } from '$lib/server/auth';
import { isMultiUserMode } from '$lib/server/bindings.server';

export const load: PageServerLoad = async (event) => {
	const binding = await resolveBinding(event);
	const allowed = isOwnerPrincipal(binding);
	return {
		authenticated: allowed,
		isOwner: allowed,
		multiUser: isMultiUserMode()
	};
};
