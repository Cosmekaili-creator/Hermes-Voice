import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import {
	buildGlancePrompt,
	GLANCE_CACHE_MS,
	GLANCE_SYSTEM_PROMPT,
	GLANCE_TIMEOUT_MS,
	parseGlance,
	type Glance
} from '$lib/server/glance.server';
import { callHermesChat } from '$lib/server/hermes';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

/** Per-binding cache — ambient screens refresh every few minutes; Hermes runs are costly. */
const cache = new Map<string, { at: number; glance: Glance }>();
/** Failures are cached briefly too, so a broken Hermes isn't re-run on every refresh. */
const failedAt = new Map<string, number>();
const FAILURE_CACHE_MS = 2 * 60_000;
const inFlight = new Map<string, Promise<Glance | null>>();

/**
 * POST — ambient-mode glance for the signed-in binding. Takes no client input beyond auth:
 * the prompt is fixed server-side and the only outbound target is the binding's own
 * (SSRF-allowlisted) Hermes via callHermesChat.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'glance', RATE.glance.limit, RATE.glance.windowMs, binding.id);

	const hit = cache.get(binding.id);
	if (hit && Date.now() - hit.at < GLANCE_CACHE_MS) {
		return json({ ok: true, ...hit.glance, fetchedAt: hit.at });
	}

	const failed = failedAt.get(binding.id);
	if (failed && Date.now() - failed < FAILURE_CACHE_MS) {
		return json({ ok: false, code: 'glance_unavailable' }, { status: 503 });
	}

	let pending = inFlight.get(binding.id);
	if (!pending) {
		pending = callHermesChat({
			request: buildGlancePrompt(new Date().toISOString()),
			// Fresh Hermes session per run: nothing read from one inbox snapshot (e.g. text
			// injected in an email) carries over into the next run's context.
			sessionId: `glance:${binding.id}:${randomUUID()}`,
			hermesApiBase: binding.hermesApiBase,
			hermesApiKey: binding.hermesApiKey,
			hermesSessionKey: binding.hermesSessionKey,
			timeoutMs: GLANCE_TIMEOUT_MS,
			systemPrompt: GLANCE_SYSTEM_PROMPT
		})
			.then(({ text }) => parseGlance(text))
			.catch(() => null)
			.finally(() => inFlight.delete(binding.id));
		inFlight.set(binding.id, pending);
	}

	const glance = await pending;
	if (!glance) {
		failedAt.set(binding.id, Date.now());
		return json({ ok: false, code: 'glance_unavailable' }, { status: 503 });
	}
	failedAt.delete(binding.id);
	const at = Date.now();
	cache.set(binding.id, { at, glance });
	return json({ ok: true, ...glance, fetchedAt: at });
};
