import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireVoiceKey } from '$lib/server/auth';
import {
	ensureBindingsImported,
	isMultiUserMode,
	redactBinding
} from '$lib/server/bindings.server';
import { applyEnvUpdatesInProcess, writeEnvFileAtomic } from '$lib/server/envFile.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { isSetupComplete } from '$lib/server/setupMode.server';

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'ownerMutate', RATE.ownerMutate.limit, RATE.ownerMutate.windowMs);

	if (!isSetupComplete()) {
		return json({ ok: false, code: 'setup_incomplete' }, { status: 400 });
	}

	// Single-user: sole key is owner. Multi-user: require owner row.
	if (isMultiUserMode()) {
		await requireOwner(event);
	} else {
		await requireVoiceKey(event);
	}

	// Seed bindings BEFORE flipping MULTI_USER so a failed import cannot leave
	// mode=on with an empty store (API lockout).
	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({ ok: false, code: imported.code }, { status: 503 });
	}

	if (!isMultiUserMode()) {
		const written = await writeEnvFileAtomic({ MULTI_USER: '1' });
		if (!written.ok) {
			return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
		}
		applyEnvUpdatesInProcess({ MULTI_USER: '1' });
	}

	return json({
		ok: true,
		multiUser: true,
		users: imported.file.users.map(redactBinding)
	});
};
