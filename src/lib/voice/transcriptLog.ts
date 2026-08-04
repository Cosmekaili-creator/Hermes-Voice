/**
 * Client-safe, pure transcript log for the opt-in conversation-memory-review feature
 * (see VoicePersona.reviewConversationForMemory). No runes, no `$env` — only ever
 * constructed when a binding has opted in (see voiceSession.svelte.ts).
 *
 * Bounded, in-memory, atomic take-and-clear: callers can never accidentally resend
 * content, and the log can never grow past the caps below regardless of session length.
 */

export type TranscriptRole = 'user' | 'assistant';
export type TranscriptTurn = { role: TranscriptRole; text: string };

export const MAX_TURN_CHARS = 2_000;
export const MAX_TRANSCRIPT_TURNS = 200;
export const MAX_TRANSCRIPT_CHARS = 12_000;
export const MIN_REVIEW_USER_CHARS = 80;

/** Sentinel key for a user utterance whose transcription event has no `item_id` yet. */
const PENDING_USER_KEY = 'pending-user';

type Slot = { role: TranscriptRole; text: string; key: string };

function firstNonEmptyStringField(
	obj: Record<string, unknown>,
	fields: readonly string[]
): string | null {
	for (const field of fields) {
		const value = obj[field];
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return null;
}

/**
 * Parses a `conversation.item.input_audio_transcription.*` server event into a
 * (key, text, mode) triple, or `null` if the event carries no usable text.
 *
 * xAI emits only a cumulative `.updated` event (no `.delta` variant for user
 * transcription — verified against xAI's own realtime docs). OpenAI's incremental
 * form uses `.delta`. A single rule covers both without provider-specific branching:
 * any event type ending in `.delta` is append-mode; everything else matching this
 * prefix (xAI's `.updated`, OpenAI's likely `.completed`) is replace-mode (cumulative).
 *
 * Text field name isn't fully documented for every provider/event — read `transcript`,
 * then `text`, then `delta`, first non-empty string wins. Tolerant, never throws: an
 * unrecognized shape simply yields `null` (silently-empty transcript), never a broken
 * session.
 */
export function readUserTranscriptEvent(
	event: { type: string; [k: string]: unknown } | null | undefined
): { key: string; text: string; mode: 'replace' | 'append' } | null {
	if (!event || typeof event.type !== 'string') return null;
	if (!event.type.startsWith('conversation.item.input_audio_transcription.')) return null;

	const text = firstNonEmptyStringField(event, ['transcript', 'text', 'delta']);
	if (!text) return null;

	const mode: 'replace' | 'append' = event.type.endsWith('.delta') ? 'append' : 'replace';
	const itemId = event.item_id;
	const key = typeof itemId === 'string' && itemId ? itemId : PENDING_USER_KEY;
	return { key, text, mode };
}

function truncateTurn(text: string): string {
	return text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text;
}

export function createTranscriptLog() {
	let order: Slot[] = [];
	const userSlots = new Map<string, Slot>();
	let assistantBuffer = '';
	let typedCounter = 0;
	let assistantCounter = 0;
	let resolvedCounter = 0;

	function totalChars(): number {
		let sum = 0;
		for (const slot of order) sum += slot.text.length;
		return sum;
	}

	function enforceCaps(): void {
		while (order.length > MAX_TRANSCRIPT_TURNS || totalChars() > MAX_TRANSCRIPT_CHARS) {
			const evicted = order.shift();
			if (!evicted) break;
			if (evicted.role === 'user' && userSlots.get(evicted.key) === evicted) {
				userSlots.delete(evicted.key);
			}
		}
	}

	function upsertUserSlot(key: string, text: string, append: boolean): void {
		let slot = userSlots.get(key);
		if (!slot) {
			slot = { role: 'user', text: '', key };
			userSlots.set(key, slot);
			order.push(slot);
		}
		slot.text = truncateTurn(append ? slot.text + text : text);
	}

	/**
	 * A `'replace'` call carrying empty/absent text is a no-op that preserves whatever
	 * text is already accumulated in that slot — a malformed/empty cumulative event must
	 * never erase real content already captured via `.delta` appends.
	 */
	function noteUserTranscript(key: string, text: string, mode: 'replace' | 'append'): void {
		const t = typeof text === 'string' ? text : '';
		if (!t) return;
		upsertUserSlot(key, t, mode === 'append');
		enforceCaps();
	}

	/** A typed turn (sendText()) is a complete, discrete user turn — never merged with others. */
	function noteUserText(text: string): void {
		const t = typeof text === 'string' ? text.trim() : '';
		if (!t) return;
		const key = `typed-${typedCounter++}`;
		const slot: Slot = { role: 'user', text: truncateTurn(t), key };
		userSlots.set(key, slot);
		order.push(slot);
		enforceCaps();
	}

	function appendAssistantDelta(delta: string): void {
		if (!delta) return;
		assistantBuffer += delta;
	}

	/**
	 * Finalizes the in-flight assistant buffer into an ordered turn (if non-empty), and
	 * freezes any turn still under the `PENDING_USER_KEY` sentinel by giving it a unique
	 * resolved key — so a late-arriving transcription event for that already-answered
	 * utterance can never land after the assistant's reply in the ordered turn list; the
	 * next new utterance starts a fresh pending slot.
	 */
	function commitAssistant(): void {
		const pending = userSlots.get(PENDING_USER_KEY);
		if (pending) {
			userSlots.delete(PENDING_USER_KEY);
			pending.key = `resolved-${resolvedCounter++}`;
			userSlots.set(pending.key, pending);
		}

		const text = assistantBuffer.trim();
		assistantBuffer = '';
		if (!text) return;
		const slot: Slot = {
			role: 'assistant',
			text: truncateTurn(text),
			key: `assistant-${assistantCounter++}`
		};
		order.push(slot);
		enforceCaps();
	}

	function hasReviewableContent(): boolean {
		let hasUser = false;
		let userChars = 0;
		for (const slot of order) {
			if (slot.role !== 'user' || !slot.text) continue;
			hasUser = true;
			userChars += slot.text.length;
		}
		return hasUser && userChars >= MIN_REVIEW_USER_CHARS;
	}

	function clear(): void {
		order = [];
		userSlots.clear();
		assistantBuffer = '';
	}

	/** Snapshot + clear, atomic — a second immediate call always returns `[]`. */
	function takeTurns(): TranscriptTurn[] {
		const snapshot = order.map((slot) => ({ role: slot.role, text: slot.text }));
		clear();
		return snapshot;
	}

	return {
		noteUserTranscript,
		noteUserText,
		appendAssistantDelta,
		commitAssistant,
		takeTurns,
		hasReviewableContent,
		clear
	};
}

export type TranscriptLog = ReturnType<typeof createTranscriptLog>;
