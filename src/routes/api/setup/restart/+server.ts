import { json, type RequestHandler } from '@sveltejs/kit';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { scheduleSelfRestart } from '$lib/server/selfRestart.server';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';

/**
 * Owner-triggered self-restart (chunk D3). Same auth gate as the save routes, no new
 * auth surface — `requireSetupOrOwner` (setup cookie/token in bootstrap mode, owner in
 * multi-user complete mode, any authenticated voice key in single-user complete mode,
 * matching every other owner-area route in this app when single-user).
 *
 * Hard opt-in kill switch: 501 `restart_unsupported` unless `ALLOW_SELF_RESTART=1`.
 * That key is deliberately absent from `MANAGED_ENV_KEYS` (envFile.server.ts) — it can
 * only ever be enabled by hand-editing `.env` or the systemd unit, never from a browser
 * or any in-app save route. Dev/Docker/CI never get a working restart button unless
 * explicitly opted in.
 *
 * Mechanism: see selfRestart.server.ts (SIGTERM, not exit(0), not server.close()).
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'setupRestart', RATE.setupRestart.limit, RATE.setupRestart.windowMs);

	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);

	if (readEnvTrimmed('ALLOW_SELF_RESTART') !== '1') {
		return json({ ok: false, code: 'restart_unsupported' }, { status: 501 });
	}

	// Non-secret (id/role/label only, see app.d.ts) — journald audit trail for who
	// triggered a restart.
	const principal = event.locals.principal;
	console.warn(
		`Hermes Voice: self-restart triggered by principal id=${principal?.id ?? 'unknown'} label=${
			principal?.label ?? 'unknown'
		}`
	);

	scheduleSelfRestart();

	return json({ ok: true });
};
