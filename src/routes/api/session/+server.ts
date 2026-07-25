import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveSessionConfig } from '$lib/providers/active.server';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { mintRealtimeClientSecret as mintOpenAI } from '$lib/server/openai';
import { mintRealtimeClientSecret as mintXai } from '$lib/server/xai';

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'mint', RATE.mint.limit, RATE.mint.windowMs, binding.id);

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
