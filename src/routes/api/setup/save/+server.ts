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
import {
	ensureBindingsImported,
	findOwner,
	isMultiUserMode,
	voiceKeyTaken,
	writeBindingsAtomic,
	type Binding
} from '$lib/server/bindings.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
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

function parseProvider(raw: string | null, fallback: string): 'xai' | 'openai' {
	const v = (raw || fallback || 'xai').toLowerCase();
	return v === 'openai' ? 'openai' : 'xai';
}

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'setupSave', RATE.setupSave.limit, RATE.setupSave.windowMs);

	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);

	const mode = getSetupMode();
	const rotation = mode === 'complete';

	const voiceUrlKey = strField(body, 'voiceUrlKey');
	const voiceProviderField = strField(body, 'voiceProvider');
	const xaiApiKey = strField(body, 'xaiApiKey');
	const openaiApiKey = strField(body, 'openaiApiKey');
	const hermesApiBase = strField(body, 'hermesApiBase');
	const hermesApiKey = strField(body, 'hermesApiKey');
	const hermesSessionKey = strField(body, 'hermesSessionKey');
	const origin = strField(body, 'origin');

	const prevVoiceKey = existing('VOICE_URL_KEY');
	const prevProvider = parseProvider(null, existing('VOICE_PROVIDER') || 'xai');

	const nextVoice = voiceUrlKey || (rotation ? prevVoiceKey : '');
	const nextProvider = parseProvider(voiceProviderField, rotation ? prevProvider : 'xai');
	const nextXai = xaiApiKey || (rotation ? existing('XAI_API_KEY') : '');
	const nextOpenAI = openaiApiKey || (rotation ? existing('OPENAI_API_KEY') : '');
	const nextHermesBase =
		hermesApiBase || (rotation ? existing('HERMES_API_BASE') : '') || 'http://127.0.0.1:8642';
	const nextHermesKey = hermesApiKey || (rotation ? existing('HERMES_API_KEY') : '');
	const nextSession =
		hermesSessionKey || (rotation ? existing('HERMES_SESSION_KEY') : '') || 'agent:main:voice';
	const nextOrigin = origin || (rotation ? existing('ORIGIN') : '') || '';

	if (!nextVoice) {
		return json({ ok: false, code: 'missing_voice_key' }, { status: 400 });
	}
	if (nextProvider === 'openai') {
		if (!nextOpenAI) {
			return json({ ok: false, code: 'missing_openai_key' }, { status: 400 });
		}
	} else if (!nextXai) {
		return json({ ok: false, code: 'missing_xai_key' }, { status: 400 });
	}
	if (!nextHermesKey) {
		return json({ ok: false, code: 'missing_hermes_key' }, { status: 400 });
	}

	const baseCheck = validateHermesApiBase(nextHermesBase);
	if (!baseCheck.ok) {
		return json({ ok: false, code: baseCheck.code }, { status: 400 });
	}

	// Multi-user: validate owner sync *before* env write so a voiceKey collision
	// cannot leave .env and bindings divergent.
	let multiUserOwnerSync: { ownerId: string; users: Binding[] } | null = null;
	if (isMultiUserMode()) {
		const imported = await ensureBindingsImported();
		if (!imported.ok) {
			return json({ ok: false, code: imported.code }, { status: 503 });
		}
		const owner = findOwner(imported.file.users);
		if (!owner) {
			return json({ ok: false, code: 'bindings_no_owner' }, { status: 500 });
		}
		if (voiceKeyTaken(imported.file.users, nextVoice, owner.id)) {
			return json({ ok: false, code: 'voice_key_taken' }, { status: 400 });
		}
		multiUserOwnerSync = { ownerId: owner.id, users: imported.file.users };
	}

	const updates: EnvUpdates = {
		VOICE_URL_KEY: nextVoice,
		VOICE_PROVIDER: nextProvider,
		HERMES_API_BASE: baseCheck.base,
		HERMES_API_KEY: nextHermesKey,
		HERMES_SESSION_KEY: nextSession,
		SETUP_COMPLETE: '1'
	};

	if (nextProvider === 'openai') {
		updates.OPENAI_API_KEY = nextOpenAI;
		if (nextXai) updates.XAI_API_KEY = nextXai;
	} else {
		updates.XAI_API_KEY = nextXai;
		if (nextOpenAI) updates.OPENAI_API_KEY = nextOpenAI;
	}

	if (nextOrigin) {
		updates.ORIGIN = nextOrigin;
	}

	if (!rotation) {
		// Bootstrap: hard-lock — clear SETUP_TOKEN on disk
		updates.SETUP_TOKEN = null;
	}

	const written = await writeEnvFileAtomic(updates);
	if (!written.ok) {
		return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
	}

	applyEnvUpdatesInProcess(updates);

	if (multiUserOwnerSync) {
		const now = new Date().toISOString();
		const nextUsers = multiUserOwnerSync.users.map((u) =>
			u.id === multiUserOwnerSync.ownerId
				? {
						...u,
						voiceKey: nextVoice,
						hermesApiBase: baseCheck.base,
						hermesApiKey: nextHermesKey,
						hermesSessionKey: nextSession,
						updatedAt: now
					}
				: u
		);
		const bw = await writeBindingsAtomic({ version: 1, users: nextUsers });
		if (!bw.ok) {
			return json({ ok: false, code: 'bindings_write_failed' }, { status: 500 });
		}
	}

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
