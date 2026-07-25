import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireVoiceKey } from '$lib/server/auth';
import {
	ensureBindingsImported,
	isMultiUserMode,
	readEnvTrimmed,
	redactBinding
} from '$lib/server/bindings.server';
import { probeHermes, probeXai } from '$lib/server/setupProbes.server';
import { isSetupComplete } from '$lib/server/setupMode.server';

export const GET: RequestHandler = async (event) => {
	if (isMultiUserMode()) {
		await requireOwner(event);
	} else {
		await requireVoiceKey(event);
	}

	const xaiKey = readEnvTrimmed('XAI_API_KEY');
	const xai = await probeXai(xaiKey);

	if (!isMultiUserMode()) {
		const hermes = await probeHermes({
			hermesApiBase: readEnvTrimmed('HERMES_API_BASE') ?? 'http://127.0.0.1:8642',
			hermesApiKey: readEnvTrimmed('HERMES_API_KEY')
		});
		return json({
			ok: xai.ok && hermes.ok,
			multiUser: false,
			setupComplete: isSetupComplete(),
			voice: {
				ok: Boolean(readEnvTrimmed('VOICE_URL_KEY'))
			},
			xai: xai.ok ? { ok: true } : { ok: false, code: xai.code },
			hermes: hermes.ok ? { ok: true } : { ok: false, code: hermes.code }
		});
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({
			ok: false,
			multiUser: true,
			setupComplete: isSetupComplete(),
			xai: xai.ok ? { ok: true } : { ok: false, code: xai.code },
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
		ok: xai.ok && allHermesOk && imported.file.users.length > 0,
		multiUser: true,
		setupComplete: isSetupComplete(),
		xai: xai.ok ? { ok: true } : { ok: false, code: xai.code },
		users
	});
};
