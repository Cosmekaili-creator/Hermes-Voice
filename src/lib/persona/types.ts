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
	/**
	 * Per-binding realtime voice override. `null` = "use the provider default"
	 * (`caps.defaultVoice` / env override) — every existing binding keeps today's exact
	 * behavior when this is unset. Resolved with precedence in
	 * `src/lib/providers/active.server.ts`'s `resolveSessionConfig()`.
	 */
	voiceId: string | null;
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
	reviewConversationForMemory: false,
	voiceId: null
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

/**
 * Realtime voice id — e.g. an xAI TTS `voice_id` or an OpenAI Realtime voice name.
 * `null` = no override (use the provider default). Strict-by-construction: anything
 * that doesn't cleanly match is rejected outright (returns `null`), never silently
 * truncated/escaped, because this value can end up written into `.env`
 * (`XAI_VOICE`/`OPENAI_VOICE`, see envFile.server.ts) or a realtime `session.update`
 * payload — see the newline-injection note below.
 */
const VOICE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeVoiceId(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// Embedded CR/LF is a real .env-injection vector once XAI_VOICE/OPENAI_VOICE join
	// MANAGED_ENV_KEYS (see envFile.server.ts's writeEnvFileAtomic newline rejection) —
	// reject outright here rather than silently stripping and letting a
	// looks-truncated-but-still-matches value slip through.
	if (/[\r\n]/.test(raw)) return null;
	const cleaned = raw.replace(CONTROL_CHARS_RE, '').trim().toLowerCase();
	return VOICE_ID_RE.test(cleaned) ? cleaned : null;
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
		),
		voiceId: normalizeVoiceId(o.voiceId)
	};
}

function normalizeTalkModePatch(
	raw: unknown,
	fallback: 'ptt' | 'handsfree' | null
): 'ptt' | 'handsfree' | null {
	if (raw === null) return null;
	return raw === 'ptt' || raw === 'handsfree' ? raw : fallback;
}

function normalizeVoiceIdPatch(raw: unknown, fallback: string | null): string | null {
	if (raw === null) return null;
	if (typeof raw !== 'string') return fallback;
	return normalizeVoiceId(raw) ?? fallback;
}

/**
 * Partial-update merge: only keys actually present (own-property, per
 * `Object.prototype.hasOwnProperty`) in `body` are considered; every absent key is
 * carried over unchanged from `current`. An invalid/garbage-typed *present* key also
 * falls back to `current`'s existing value — never to `DEFAULT_PERSONA`.
 *
 * This is the direct fix for a footgun in naively calling `normalizePersona()` on a
 * partial request body: that function fills every absent field from `DEFAULT_PERSONA`,
 * so a single-field edit (e.g. `{ autoGreet: true }`) would silently reset every other
 * persona field (assistant name, silence timeout, etc.) back to the default. Used by
 * the owner users PATCH route (`src/routes/api/owner/users/[id]/+server.ts`).
 */
export function mergePersonaPatch(current: VoicePersona, body: unknown): VoicePersona {
	const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

	return {
		assistantName: has('assistantName')
			? normalizeName(o.assistantName, current.assistantName)
			: current.assistantName,
		addressName: has('addressName')
			? normalizeName(o.addressName, current.addressName)
			: current.addressName,
		formalAddress: has('formalAddress')
			? normalizeBool(o.formalAddress, current.formalAddress)
			: current.formalAddress,
		patientSilence: has('patientSilence')
			? normalizeBool(o.patientSilence, current.patientSilence)
			: current.patientSilence,
		autoGreet: has('autoGreet') ? normalizeBool(o.autoGreet, current.autoGreet) : current.autoGreet,
		handsFreeSilenceMs: has('handsFreeSilenceMs')
			? normalizeSilenceMs(o.handsFreeSilenceMs, current.handsFreeSilenceMs)
			: current.handsFreeSilenceMs,
		defaultTalkMode: has('defaultTalkMode')
			? normalizeTalkModePatch(o.defaultTalkMode, current.defaultTalkMode)
			: current.defaultTalkMode,
		reviewConversationForMemory: has('reviewConversationForMemory')
			? normalizeBool(o.reviewConversationForMemory, current.reviewConversationForMemory)
			: current.reviewConversationForMemory,
		voiceId: has('voiceId') ? normalizeVoiceIdPatch(o.voiceId, current.voiceId) : current.voiceId
	};
}
