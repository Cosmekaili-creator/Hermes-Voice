import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import {
	ensureBindingsImported,
	isMultiUserMode
} from '$lib/server/bindings.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { probeHermes, validateHermesApiBase } from '$lib/server/setupProbes.server';

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'setupProbe', RATE.setupProbe.limit, RATE.setupProbe.windowMs);
	await requireOwner(event);
	if (!isMultiUserMode()) {
		return json({ ok: false, code: 'multi_user_disabled' }, { status: 400 });
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({ ok: false, code: imported.code }, { status: 503 });
	}

	const id = event.params.id;
	const user = imported.file.users.find((u) => u.id === id);
	if (!user) {
		return json({ ok: false, code: 'not_found' }, { status: 404 });
	}

	const body = await event.request.json().catch(() => ({}));
	const overrideBase =
		body && typeof body === 'object' && typeof (body as { hermesApiBase?: unknown }).hermesApiBase === 'string'
			? String((body as { hermesApiBase: string }).hermesApiBase).trim()
			: '';
	const overrideKey =
		body && typeof body === 'object' && typeof (body as { hermesApiKey?: unknown }).hermesApiKey === 'string'
			? String((body as { hermesApiKey: string }).hermesApiKey).trim()
			: '';

	const baseRaw = overrideBase || user.hermesApiBase;
	const baseCheck = validateHermesApiBase(baseRaw);
	if (!baseCheck.ok) {
		return json({ ok: false, code: baseCheck.code }, { status: 400 });
	}

	const result = await probeHermes({
		hermesApiBase: baseCheck.base,
		hermesApiKey: overrideKey || user.hermesApiKey
	});

	if (!result.ok) {
		return json({ ok: false, code: result.code });
	}
	return json({ ok: true });
};
