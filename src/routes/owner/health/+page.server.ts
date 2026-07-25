import type { PageServerLoad } from './$types';
import { isAuthenticated } from '$lib/server/auth';

export const load: PageServerLoad = (event) => {
	return { authenticated: isAuthenticated(event) };
};
