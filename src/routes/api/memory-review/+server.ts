import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { personaFromBinding } from '$lib/server/bindings.server';
import { callHermesChat } from '$lib/server/hermes';
import {
	buildMemoryReviewPrompt,
	MEMORY_REVIEW_SYSTEM_PROMPT,
	MEMORY_REVIEW_TIMEOUT_MS,
	sanitizeTranscriptTurns
} from '$lib/server/memoryReview.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

const MAX_CONCURRENT_REVIEWS_PER_BINDING = 2;

/**
 * In-flight Hermes-review count per binding — a Map, not a single global counter, so one
 * busy binding can never starve every other binding sharing this process (QC M5). Tracks
 * only the detached Hermes call kicked off below, not the whole request lifecycle.
 */
const inFlightByBinding = new Map<string, number>();

function beginReview(bindingId: string): boolean {
	const current = inFlightByBinding.get(bindingId) ?? 0;
	if (current >= MAX_CONCURRENT_REVIEWS_PER_BINDING) return false;
	inFlightByBinding.set(bindingId, current + 1);
	return true;
}

function endReview(bindingId: string): void {
	const current = inFlightByBinding.get(bindingId) ?? 0;
	if (current <= 1) {
		inFlightByBinding.delete(bindingId);
	} else {
		inFlightByBinding.set(bindingId, current - 1);
	}
}

/**
 * Opt-in conversation-memory review (see VoicePersona.reviewConversationForMemory).
 * Mirrors /api/greeting's structure, with load-bearing differences:
 *
 * - Unlike greeting, this endpoint accepts substantial client-supplied text (the
 *   transcript) — see memoryReview.server.ts for the sanitization/quarantine stack.
 * - Responds 202 immediately; the actual Hermes call runs detached (fire-and-forget)
 *   below. `event.request.signal` is deliberately NOT passed to callHermesChat: greeting
 *   passes it because a stale greeting nobody's waiting for is worth cancelling, but here
 *   the opposite holds — the user may already be walking away or about to close the tab,
 *   and the memory write should complete regardless of the HTTP request's own lifecycle.
 * - The response body never contains any Hermes-generated text — this is a security
 *   property, not an oversight. Echoing the model's reply back would turn this into a
 *   general-purpose authenticated "send text, get an LLM reply" proxy, since (unlike
 *   greeting) this endpoint takes real client-supplied text as input. The reply is
 *   discarded entirely; the endpoint is write-only from the caller's perspective.
 * - Timeout is 90s (MEMORY_REVIEW_TIMEOUT_MS) — well above what a memory-tool round trip
 *   needs, safely under the shared 120s HERMES_TIMEOUT_MS, unlike greeting's tight 20s;
 *   nobody is waiting on this one.
 *
 * Never logs transcript content — this route touches no logging at all beyond what
 * callHermesChat's own internals already do for HTTP-level failures (redacted, no body
 * echo). Also never touches the /api/debug/captions plaintext debug sink — unrelated
 * mechanism, no shared code path.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(
		event,
		'memoryReview',
		RATE.memoryReview.limit,
		RATE.memoryReview.windowMs,
		binding.id
	);

	const persona = personaFromBinding(binding);
	if (!persona.reviewConversationForMemory) {
		// Indistinguishable from a nonexistent route for bindings without this enabled.
		return json({ ok: false, code: 'review_disabled' }, { status: 404 });
	}

	const rawTranscript =
		body && typeof body === 'object' && 'transcript' in body
			? (body as { transcript?: unknown }).transcript
			: undefined;
	const turns = sanitizeTranscriptTurns(rawTranscript);
	if (!turns) {
		return json({ ok: false, code: 'transcript_unusable' }, { status: 400 });
	}

	if (!beginReview(binding.id)) {
		return json({ ok: false, code: 'review_busy' }, { status: 503 });
	}

	const rawSessionId =
		body && typeof body === 'object' && 'session_id' in body
			? String((body as { session_id?: unknown }).session_id ?? '').trim()
			: '';
	// Deliberately NOT the live conversation's session_id: posting the same id would land
	// this review in the *same* Hermes-side thread as the live chat — exactly the most
	// favorable condition for the action-replay risk (the backend would already have the
	// live context primed). A distinct, clearly-namespaced derivation keeps it associated
	// with the right binding/session for debugging without that risk.
	const reviewSessionId = `${rawSessionId || 'unknown'}:review`;

	void (async () => {
		try {
			await callHermesChat({
				request: buildMemoryReviewPrompt({
					turns,
					assistantName: persona.assistantName,
					addressName: persona.addressName,
					locale: event.locals.locale
				}),
				sessionId: reviewSessionId,
				hermesApiBase: binding.hermesApiBase,
				hermesApiKey: binding.hermesApiKey,
				hermesSessionKey: binding.hermesSessionKey,
				timeoutMs: MEMORY_REVIEW_TIMEOUT_MS,
				systemPrompt: MEMORY_REVIEW_SYSTEM_PROMPT
			});
		} catch {
			// Swallowed — a failed background review must never surface as a request
			// failure (the 202 response is already sent) and must never log transcript
			// content; callHermesChat's own internals already log HTTP-level failures
			// without echoing bodies.
		} finally {
			endReview(binding.id);
		}
	})();

	return json({ ok: true }, { status: 202 });
};
