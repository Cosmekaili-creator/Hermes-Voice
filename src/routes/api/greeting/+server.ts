import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { personaFromBinding } from '$lib/server/bindings.server';
import {
	buildGreetingPrompt,
	GREETING_SYSTEM_PROMPT,
	GREETING_TIMEOUT_MS,
	sanitizeGreetingText
} from '$lib/server/greeting.server';
import { callHermesChat } from '$lib/server/hermes';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

/**
 * Auto-greet opening line. Takes ZERO prompt text from the client — only `session_id` —
 * the prompt is composed 100% server-side from the resolved binding's persona, so
 * addressName/persona content never has to round-trip through client-editable territory
 * (the alternative of reusing /api/hermes would require exactly that).
 *
 * No new outbound fetch target: this reuses callHermesChat() → resolveHermesFetchTarget /
 * isAllowedHermesHost, the same SSRF-allowlisted path /api/hermes already uses.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'greeting', RATE.greeting.limit, RATE.greeting.windowMs, binding.id);

	const persona = personaFromBinding(binding);
	if (!persona.autoGreet) {
		// Indistinguishable from a no-op for bindings without auto-greet (e.g. the default owner binding).
		return json({ ok: false, code: 'greeting_disabled' }, { status: 404 });
	}

	const sessionId =
		body && typeof body === 'object' && 'session_id' in body
			? String((body as { session_id?: unknown }).session_id ?? '').trim() || undefined
			: undefined;

	try {
		const { text } = await callHermesChat({
			request: buildGreetingPrompt({
				addressName: persona.addressName,
				assistantName: persona.assistantName,
				locale: event.locals.locale
			}),
			sessionId,
			signal: event.request.signal,
			hermesApiBase: binding.hermesApiBase,
			hermesApiKey: binding.hermesApiKey,
			hermesSessionKey: binding.hermesSessionKey,
			timeoutMs: GREETING_TIMEOUT_MS,
			systemPrompt: GREETING_SYSTEM_PROMPT
		});

		const clean = sanitizeGreetingText(text);
		if (!clean) {
			return json({ ok: false, code: 'greeting_empty' }, { status: 503 });
		}
		return json({ ok: true, text: clean });
	} catch {
		// Never let a thrown error (including abort/timeout) escape as a 500 — a failed
		// greeting is a nice-to-have, not a required step.
		return json({ ok: false, code: 'greeting_unavailable' }, { status: 503 });
	}
};
