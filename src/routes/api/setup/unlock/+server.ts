import { json, type RequestHandler } from '@sveltejs/kit';
import {
	getSetupMode,
	grantSetupCookie,
	isValidSetupToken,
	extractSetupToken
} from '$lib/server/setupMode.server';

export const POST: RequestHandler = async (event) => {
	if (getSetupMode() !== 'bootstrap') {
		return json({ ok: false, code: 'setup_locked' }, { status: 403 });
	}

	const body = await event.request.json().catch(() => ({}));
	const token = extractSetupToken(event, body);
	if (!isValidSetupToken(token)) {
		return json({ ok: false, code: 'invalid_token' }, { status: 403 });
	}

	grantSetupCookie(event);
	return json({ ok: true });
};
