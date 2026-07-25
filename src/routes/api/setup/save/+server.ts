import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	applyEnvUpdatesInProcess,
	writeEnvFileAtomic,
	type EnvUpdates
} from '$lib/server/envFile.server';
import {
	clearSetupCookie,
	getSetupMode,
	requireSetupOrOwner,
	revokeBootstrapInProcess
} from '$lib/server/setupMode.server';
import { clearSessionCookie } from '$lib/server/auth';
import { validateHermesApiBase } from '$lib/server/setupProbes.server';

function strField(body: unknown, key: string): string | null {
	if (!body || typeof body !== 'object') return null;
	const v = (body as Record<string, unknown>)[key];
	return typeof v === 'string' ? v.trim() : null;
}

function existing(key: string): string {
	// Prefer process.env (may be updated after prior save) over $env snapshot.
	return process.env[key]?.trim() || env[key]?.trim() || '';
}

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	requireSetupOrOwner(event, body);

	const mode = getSetupMode();
	const rotation = mode === 'complete';

	const voiceUrlKey = strField(body, 'voiceUrlKey');
	const xaiApiKey = strField(body, 'xaiApiKey');
	const hermesApiBase = strField(body, 'hermesApiBase');
	const hermesApiKey = strField(body, 'hermesApiKey');
	const hermesSessionKey = strField(body, 'hermesSessionKey');
	const origin = strField(body, 'origin');

	const prevVoiceKey = existing('VOICE_URL_KEY');

	const nextVoice = voiceUrlKey || (rotation ? prevVoiceKey : '');
	const nextXai = xaiApiKey || (rotation ? existing('XAI_API_KEY') : '');
	const nextHermesBase =
		hermesApiBase || (rotation ? existing('HERMES_API_BASE') : '') || 'http://127.0.0.1:8642';
	const nextHermesKey = hermesApiKey || (rotation ? existing('HERMES_API_KEY') : '');
	const nextSession =
		hermesSessionKey ||
		(rotation ? existing('HERMES_SESSION_KEY') : '') ||
		'agent:main:voice';
	const nextOrigin = origin || (rotation ? existing('ORIGIN') : '') || '';

	if (!nextVoice) {
		return json({ ok: false, code: 'missing_voice_key' }, { status: 400 });
	}
	if (!nextXai) {
		return json({ ok: false, code: 'missing_xai_key' }, { status: 400 });
	}
	if (!nextHermesKey) {
		return json({ ok: false, code: 'missing_hermes_key' }, { status: 400 });
	}

	const baseCheck = validateHermesApiBase(nextHermesBase);
	if (!baseCheck.ok) {
		return json({ ok: false, code: baseCheck.code }, { status: 400 });
	}

	const updates: EnvUpdates = {
		VOICE_URL_KEY: nextVoice,
		XAI_API_KEY: nextXai,
		HERMES_API_BASE: baseCheck.base,
		HERMES_API_KEY: nextHermesKey,
		HERMES_SESSION_KEY: nextSession,
		SETUP_COMPLETE: '1'
	};

	if (nextOrigin) {
		updates.ORIGIN = nextOrigin;
	}

	if (!rotation) {
		// Bootstrap: hard-lock — clear SETUP_TOKEN on disk
		updates.SETUP_TOKEN = null;
	}

	// Blank rotation fields already resolved to existing; only write submitted managed keys.
	// For rotation, omit keys the client left blank that we kept from env (still write resolved values
	// so file stays consistent). Always write the resolved set above.

	const written = await writeEnvFileAtomic(updates);
	if (!written.ok) {
		return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
	}

	applyEnvUpdatesInProcess(updates);

	if (!rotation) {
		revokeBootstrapInProcess();
		clearSetupCookie(event.cookies);
	}

	// VOICE_URL_KEY change invalidates derived Lounge cookies; clear now.
	if (voiceUrlKey && voiceUrlKey !== prevVoiceKey) {
		clearSessionCookie(event.cookies);
	}

	return json({ ok: true, restartRequired: true });
};
