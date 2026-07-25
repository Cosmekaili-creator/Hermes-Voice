import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveBinding } from '$lib/server/auth';
import { isMultiUserMode } from '$lib/server/bindings.server';
import { getSetupMode, isSetupUnlocked } from '$lib/server/setupMode.server';

export const GET: RequestHandler = async (event) => {
	const mode = getSetupMode();
	let unlocked = false;
	if (mode === 'bootstrap') {
		unlocked = isSetupUnlocked(event);
	} else if (mode === 'complete') {
		const binding = await resolveBinding(event);
		unlocked = isMultiUserMode() ? binding?.role === 'owner' : binding !== null;
	}

	return json({ mode, unlocked });
};
