import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { personaFromBinding } from '$lib/server/bindings.server';
import { streamHermesChat } from '$lib/server/hermes';
import {
	buildMemoryReviewPrompt,
	MAX_REVIEW_BODY_BYTES,
	MEMORY_REVIEW_SYSTEM_PROMPT,
	MEMORY_REVIEW_TIMEOUT_MS,
	reviewAllowedTools,
	reviewTripwireMode,
	sanitizeToolName,
	sanitizeTranscriptTurns,
	transcriptFingerprint
} from '$lib/server/memoryReview.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforcePrincipalRateLimit, enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

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

/** How long an identical transcript is remembered, per binding (replay dedupe). */
const REPLAY_WINDOW_MS = 24 * 60 * 60_000;
const MAX_REPLAY_ENTRIES = 2_000;
const recentReviews = new Map<string, number>();

/** True when this binding already had this exact transcript reviewed inside the window. */
function seenRecently(bindingId: string, fingerprint: string, now: number): boolean {
	const expiresAt = recentReviews.get(`${bindingId}:${fingerprint}`);
	return expiresAt !== undefined && expiresAt > now;
}

function rememberReview(bindingId: string, fingerprint: string, now: number): void {
	if (recentReviews.size >= MAX_REPLAY_ENTRIES) {
		for (const [k, exp] of recentReviews) {
			if (exp <= now) recentReviews.delete(k);
		}
		// Still full of live entries: drop the oldest-inserted.
		for (const k of recentReviews.keys()) {
			if (recentReviews.size < MAX_REPLAY_ENTRIES) break;
			recentReviews.delete(k);
		}
	}
	recentReviews.set(`${bindingId}:${fingerprint}`, now + REPLAY_WINDOW_MS);
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
 * - Bounded per binding, not per address: a 256 KB body cap, a daily review ceiling, and
 *   a 24 h replay dedupe (an identical transcript is acknowledged and ignored). The
 *   review uses the streaming Hermes call so a tool tripwire can see which tools the
 *   agent starts (see memoryReview.server.ts) — still write-only, reply discarded.
 *
 * Never logs transcript content — the only line this route logs is the tripwire's
 * `tool_blocked` (binding id + sanitised tool name), beyond what the Hermes client's own
 * internals already do for HTTP-level failures (redacted, no body echo). Also never touches the /api/debug/captions plaintext debug sink — unrelated
 * mechanism, no shared code path.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	// Size cap before the body is read (content-length), and again on what was actually
	// read — a chunked request carries no content-length.
	const declaredLength = Number(event.request.headers.get('content-length') ?? 0);
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REVIEW_BODY_BYTES) {
		return json({ ok: false, code: 'payload_too_large' }, { status: 413 });
	}
	const rawBody = await event.request.text().catch(() => '');
	if (Buffer.byteLength(rawBody, 'utf8') > MAX_REVIEW_BODY_BYTES) {
		return json({ ok: false, code: 'payload_too_large' }, { status: 413 });
	}
	let body: unknown;
	try {
		body = rawBody ? JSON.parse(rawBody) : {};
	} catch {
		body = {};
	}
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

	// An identical transcript inside the window is acknowledged and ignored: a replayed
	// request can't buy extra Hermes turns. Checked before the daily budget is spent.
	const fingerprint = transcriptFingerprint(turns);
	if (seenRecently(binding.id, fingerprint, Date.now())) {
		return json({ ok: true }, { status: 202 });
	}
	enforcePrincipalRateLimit(
		event,
		'memoryReviewDaily',
		RATE.memoryReviewDaily.limit,
		RATE.memoryReviewDaily.windowMs,
		binding.id
	);

	if (!beginReview(binding.id)) {
		return json({ ok: false, code: 'review_busy' }, { status: 503 });
	}
	rememberReview(binding.id, fingerprint, Date.now());

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
		// Own controller (not the HTTP request's signal — see above) so the review can be
		// timed out, and cancelled by the tool tripwire.
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), MEMORY_REVIEW_TIMEOUT_MS);
		const allowedTools = reviewAllowedTools();
		const abortOnBlocked = reviewTripwireMode() === 'abort';
		const safeBindingId = binding.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
		const reported = new Set<string>();
		try {
			await streamHermesChat({
				request: buildMemoryReviewPrompt({
					turns,
					assistantName: persona.assistantName,
					addressName: persona.addressName,
					locale: event.locals.locale
				}),
				sessionId: reviewSessionId,
				signal: ac.signal,
				hermesApiBase: binding.hermesApiBase,
				hermesApiKey: binding.hermesApiKey,
				hermesSessionKey: binding.hermesSessionKey,
				systemPrompt: MEMORY_REVIEW_SYSTEM_PROMPT,
				onToolProgress: (progress) => {
					const tool = sanitizeToolName(progress.tool);
					if (allowedTools.has(tool)) return;
					// Tool name only — never transcript or tool-argument content.
					if (!reported.has(tool)) {
						reported.add(tool);
						console.log(`hv-memory-review tool_blocked binding=${safeBindingId} tool=${tool}`);
					}
					if (abortOnBlocked) ac.abort();
				}
			});
		} catch {
			// Swallowed — a failed background review must never surface as a request
			// failure (the 202 response is already sent) and must never log transcript
			// content; the Hermes client's own internals already log HTTP-level failures
			// without echoing bodies.
		} finally {
			clearTimeout(timer);
			endReview(binding.id);
		}
	})();

	return json({ ok: true }, { status: 202 });
};
