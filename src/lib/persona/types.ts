/**
 * Voice persona — per-binding presentation/behavior overrides layered on top of the
 * default Hermes persona. Client-safe: no `$env`, no server imports. Persona is NOT a
 * secret (see bindings.server.ts) — it is safe to ship to the browser via page data.
 */

export type VoicePersona = {
	assistantName: string;
	addressName: string;
	formalAddress: boolean;
	patientSilence: boolean;
	autoGreet: boolean;
	handsFreeSilenceMs: number;
	defaultTalkMode: 'ptt' | 'handsfree' | null;
	/**
	 * Opt-in conversation memory review. When true: requests user-side speech
	 * transcription from the realtime provider, keeps a bounded client-side transcript
	 * of both sides of a hands-free conversation, and posts it to this binding's own
	 * Hermes backend for a dedicated memory-extraction pass when the conversation is
	 * explicitly ended. Default false — fully inert, zero behavioral change, when unset.
	 */
	reviewConversationForMemory: boolean;
};

export const DEFAULT_ASSISTANT_NAME = 'Hermes';

export const DEFAULT_PERSONA: VoicePersona = {
	assistantName: DEFAULT_ASSISTANT_NAME,
	addressName: '',
	formalAddress: false,
	patientSilence: false,
	autoGreet: false,
	handsFreeSilenceMs: 1200,
	defaultTalkMode: null,
	reviewConversationForMemory: false
};

export const MIN_HANDS_FREE_SILENCE_MS = 400;
export const MAX_HANDS_FREE_SILENCE_MS = 15_000;
export const MAX_PERSONA_NAME_CHARS = 40;

// C0 + C1 control characters.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F-\x9F]/g;

function normalizeName(raw: unknown, fallback: string): string {
	if (typeof raw !== 'string') return fallback;
	const cleaned = raw.replace(CONTROL_CHARS_RE, '').trim();
	if (!cleaned) return fallback;
	return cleaned.slice(0, MAX_PERSONA_NAME_CHARS);
}

function normalizeBool(raw: unknown, fallback: boolean): boolean {
	return typeof raw === 'boolean' ? raw : fallback;
}

function normalizeSilenceMs(raw: unknown, fallback: number): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
	const rounded = Math.round(raw);
	return Math.min(MAX_HANDS_FREE_SILENCE_MS, Math.max(MIN_HANDS_FREE_SILENCE_MS, rounded));
}

function normalizeTalkMode(raw: unknown): 'ptt' | 'handsfree' | null {
	return raw === 'ptt' || raw === 'handsfree' ? raw : null;
}

/** Unknown/invalid input, or any invalid individual field, falls back to DEFAULT_PERSONA per field. */
export function normalizePersona(raw: unknown): VoicePersona {
	const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		assistantName: normalizeName(o.assistantName, DEFAULT_PERSONA.assistantName),
		addressName: normalizeName(o.addressName, DEFAULT_PERSONA.addressName),
		formalAddress: normalizeBool(o.formalAddress, DEFAULT_PERSONA.formalAddress),
		patientSilence: normalizeBool(o.patientSilence, DEFAULT_PERSONA.patientSilence),
		autoGreet: normalizeBool(o.autoGreet, DEFAULT_PERSONA.autoGreet),
		handsFreeSilenceMs: normalizeSilenceMs(
			o.handsFreeSilenceMs,
			DEFAULT_PERSONA.handsFreeSilenceMs
		),
		defaultTalkMode: normalizeTalkMode(o.defaultTalkMode),
		reviewConversationForMemory: normalizeBool(
			o.reviewConversationForMemory,
			DEFAULT_PERSONA.reviewConversationForMemory
		)
	};
}
