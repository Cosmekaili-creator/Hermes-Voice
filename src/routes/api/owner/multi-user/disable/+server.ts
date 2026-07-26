import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import {
	ensureBindingsImported,
	findOwner,
	isMultiUserMode,
	syncOwnerToEnv
} from '$lib/server/bindings.server';
import { applyEnvUpdatesInProcess, writeEnvFileAtomic } from '$lib/server/envFile.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

/** Sync owner → .env then clear MULTI_USER so single-user env auth works. */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'ownerMutate', RATE.ownerMutate.limit, RATE.ownerMutate.windowMs);
	await requireOwner(event);
	if (!isMultiUserMode()) {
		return json({ ok: true, multiUser: false });
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({ ok: false, code: imported.code }, { status: 503 });
	}

	const owner = findOwner(imported.file.users);
	if (!owner) {
		return json({ ok: false, code: 'last_owner' }, { status: 500 });
	}

	const envSync = await syncOwnerToEnv(owner);
	if (!envSync.ok) {
		return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
	}

	const written = await writeEnvFileAtomic({ MULTI_USER: null });
	if (!written.ok) {
		return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
	}
	applyEnvUpdatesInProcess({ MULTI_USER: null });

	return json({ ok: true, multiUser: false });
};
