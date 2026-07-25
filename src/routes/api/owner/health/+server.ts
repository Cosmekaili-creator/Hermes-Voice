import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveProvider } from '$lib/providers/active.server';
import { requireOwner, requireVoiceKey } from '$lib/server/auth';
import {
	ensureBindingsImported,
	isMultiUserMode,
	readEnvTrimmed,
	redactBinding
} from '$lib/server/bindings.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { probeHermes, probeOpenAI, probeXai } from '$lib/server/setupProbes.server';
import { isSetupComplete } from '$lib/server/setupMode.server';

function probeField(result: { ok: true } | { ok: false; code: string }) {
	return result.ok ? { ok: true as const } : { ok: false as const, code: result.code };
}

export const GET: RequestHandler = async (event) => {
	enforceRateLimit(event, 'ownerHealth', RATE.ownerHealth.limit, RATE.ownerHealth.windowMs);

	if (isMultiUserMode()) {
		await requireOwner(event);
	} else {
		await requireVoiceKey(event);
	}

	const provider = getActiveProvider();
	const voiceProbe =
		provider === 'openai'
			? await probeOpenAI(readEnvTrimmed('OPENAI_API_KEY'))
			: await probeXai(readEnvTrimmed('XAI_API_KEY'));
	const voiceProvider = probeField(voiceProbe);
	const providerFields =
		provider === 'openai'
			? { openai: voiceProvider }
			: { xai: voiceProvider };

	if (!isMultiUserMode()) {
		const hermes = await probeHermes({
			hermesApiBase: readEnvTrimmed('HERMES_API_BASE') ?? 'http://127.0.0.1:8642',
			hermesApiKey: readEnvTrimmed('HERMES_API_KEY')
		});
		return json({
			ok: voiceProvider.ok && hermes.ok,
			multiUser: false,
			setupComplete: isSetupComplete(),
			provider,
			voice: {
				ok: Boolean(readEnvTrimmed('VOICE_URL_KEY'))
			},
			voiceProvider,
			...providerFields,
			hermes: hermes.ok ? { ok: true } : { ok: false, code: hermes.code }
		});
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({
			ok: false,
			multiUser: true,
			setupComplete: isSetupComplete(),
			provider,
			voiceProvider,
			...providerFields,
			bindings: { ok: false, code: imported.code },
			users: []
		});
	}

	const users = [];
	let allHermesOk = true;
	for (const u of imported.file.users) {
		const hermes = u.enabled
			? await probeHermes({
					hermesApiBase: u.hermesApiBase,
					hermesApiKey: u.hermesApiKey
				})
			: { ok: false as const, code: 'disabled' };
		if (!hermes.ok) allHermesOk = false;
		users.push({
			...redactBinding(u),
			hermes: hermes.ok ? { ok: true } : { ok: false, code: hermes.code }
		});
	}

	return json({
		ok: voiceProvider.ok && allHermesOk && imported.file.users.length > 0,
		multiUser: true,
		setupComplete: isSetupComplete(),
		provider,
		voiceProvider,
		...providerFields,
		users
	});
};
