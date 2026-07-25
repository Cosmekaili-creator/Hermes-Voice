import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { probeHermes, probeXai } from '$lib/server/setupProbes.server';
import { isSetupComplete } from '$lib/server/setupMode.server';

export const GET: RequestHandler = async (event) => {
	requireVoiceKey(event);

	const xai = await probeXai(env.XAI_API_KEY ?? null);
	const hermes = await probeHermes({
		hermesApiBase: env.HERMES_API_BASE ?? 'http://127.0.0.1:8642',
		hermesApiKey: env.HERMES_API_KEY ?? null
	});

	return json({
		ok: xai.ok && hermes.ok,
		setupComplete: isSetupComplete(),
		voice: {
			ok: Boolean(env.VOICE_URL_KEY?.trim())
		},
		xai: xai.ok ? { ok: true } : { ok: false, code: xai.code },
		hermes: hermes.ok ? { ok: true } : { ok: false, code: hermes.code }
	});
};
