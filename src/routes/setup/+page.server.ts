import type { PageServerLoad } from './$types';
import {
	checkSetupToken,
	extractSetupToken,
	grantSetupCookie,
	setupPageFlags
} from '$lib/server/setupMode.server';

export const load: PageServerLoad = async (event) => {
	const flags = await setupPageFlags(event);

	// Bootstrap: ?token= unlocks and sets setup cookie (never Lounge cookie).
	if (flags.mode === 'bootstrap') {
		const token = extractSetupToken(event);
		if (checkSetupToken(event, token)) {
			grantSetupCookie(event);
			return { ...(await setupPageFlags(event)), justUnlocked: true };
		}
	}

	return { ...flags, justUnlocked: false };
};
