import { json, type RequestHandler } from '@sveltejs/kit';
import { getSetupMode, isSetupUnlocked } from '$lib/server/setupMode.server';
import { isAuthenticated } from '$lib/server/auth';

export const GET: RequestHandler = async (event) => {
	const mode = getSetupMode();
	const unlocked =
		mode === 'bootstrap'
			? isSetupUnlocked(event)
			: mode === 'complete'
				? isAuthenticated(event)
				: false;

	return json({ mode, unlocked });
};
