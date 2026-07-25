import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveSessionConfig } from '$lib/providers/active.server';
import { requireVoiceKey } from '$lib/server/auth';
import { mintRealtimeClientSecret as mintOpenAI } from '$lib/server/openai';
import { mintRealtimeClientSecret as mintXai } from '$lib/server/xai';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	await requireVoiceKey(event, body);

	const config = resolveSessionConfig();
	const token =
		config.provider === 'openai'
			? await mintOpenAI({ model: config.model })
			: await mintXai();

	return json({
		value: token.value,
		expires_at: token.expires_at,
		provider: config.provider,
		model: config.model,
		voice: config.voice
	});
};
