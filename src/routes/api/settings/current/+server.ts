import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveProvider } from '$lib/providers/active.server';
import { requireOwner, requireVoiceKey } from '$lib/server/auth';
import {
	ensureBindingsImported,
	findOwner,
	hintLast4,
	isMultiUserMode
} from '$lib/server/bindings.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';

type SecretField = { fieldSet: boolean; fieldHint: string };

/**
 * Secrets NEVER reach the browser as plaintext, not even owner-only — matches the
 * codebase's existing convention set by `redactBinding()` in bindings.server.ts.
 */
function secretField(value: string): SecretField {
	return { fieldSet: Boolean(value), fieldHint: value ? hintLast4(value) : '' };
}

/**
 * Owner-only prefill read for the settings modal (chunk A). Non-secret fields
 * (`provider`, `voiceId`, `hermesApiBase`, `multiUser`) are returned in plaintext for
 * diffing/prefill; secret/identity fields (`xaiApiKey`, `openaiApiKey`, `hermesApiKey`,
 * `hermesSessionKey`) are returned as `{fieldSet, fieldHint}` only — `hermesSessionKey`
 * is treated as secret-tier here even though it's a routing label, not a credential,
 * matching how `redactBinding()` already treats it.
 *
 * In multi-user mode `hermesApiBase`/`hermesSessionKey`/`hermesApiKey`/`voiceId` are the
 * authoritative values from the owner's binding row (the live box runs MULTI_USER=1),
 * not `.env`. `provider`/`xaiApiKey`/`openaiApiKey` remain process-wide/ops-level env
 * values regardless of multi-user mode (there is no per-user provider picker).
 */
export const GET: RequestHandler = async (event) => {
	enforceRateLimit(event, 'ownerHealth', RATE.ownerHealth.limit, RATE.ownerHealth.windowMs);

	const multiUser = isMultiUserMode();
	if (multiUser) {
		await requireOwner(event);
	} else {
		await requireVoiceKey(event);
	}

	const provider = getActiveProvider();

	let hermesApiBase = readEnvTrimmed('HERMES_API_BASE') ?? '';
	let hermesApiKey = readEnvTrimmed('HERMES_API_KEY') ?? '';
	let hermesSessionKey = readEnvTrimmed('HERMES_SESSION_KEY') ?? '';
	let voiceId: string | null = null;

	if (multiUser) {
		const imported = await ensureBindingsImported();
		if (!imported.ok) {
			return json({ ok: false, code: imported.code }, { status: 503 });
		}
		const owner = findOwner(imported.file.users);
		if (owner) {
			hermesApiBase = owner.hermesApiBase;
			hermesApiKey = owner.hermesApiKey;
			hermesSessionKey = owner.hermesSessionKey;
			voiceId = owner.voiceId;
		}
	} else {
		const envVoiceKey = provider === 'openai' ? 'OPENAI_VOICE' : 'XAI_VOICE';
		voiceId = readEnvTrimmed(envVoiceKey);
	}

	return json({
		ok: true,
		provider,
		voiceId,
		hermesApiBase,
		multiUser,
		xaiApiKey: secretField(readEnvTrimmed('XAI_API_KEY') ?? ''),
		openaiApiKey: secretField(readEnvTrimmed('OPENAI_API_KEY') ?? ''),
		hermesApiKey: secretField(hermesApiKey),
		hermesSessionKey: secretField(hermesSessionKey),
		// Non-secret boolean — lets the settings modal hide the "Restart service" action
		// entirely rather than offer a button that would just 501 (chunk D3's hard
		// opt-in kill switch). Mirrors D2's "only offer restart when it would actually
		// work" philosophy.
		selfRestartEnabled: readEnvTrimmed('ALLOW_SELF_RESTART') === '1'
	});
};
