/**
 * Auto-greet prompt building + reply sanitization. Pure, no I/O — the actual Hermes call
 * lives in `callHermesChat` (hermes.ts); the route (`routes/api/greeting/`) wires them together.
 */
import type { Locale } from '$lib/i18n';
import { HERMES_EMPTY_REPLY } from './hermes';

export const GREETING_TIMEOUT_MS = 20_000;
export const MAX_GREETING_CHARS = 300;

/** Lean system prompt override for callHermesChat() — no browsing/search tools, so a short
 * greeting timeout isn't blown on a scrape attempt for what should be a quick, chatty reply. */
export const GREETING_SYSTEM_PROMPT = [
	'You are handling a brief, low-stakes voice-greeting request from Hermes Voice.',
	'Reply directly and briefly. Do not use web search, browsing, or scraping tools for this',
	'request — check memory only if instantly available, otherwise just produce the greeting.'
].join(' ');

const UI_LOCALE_NAME: Record<Locale, string> = {
	en: 'English',
	fr: 'French',
	es: 'Spanish'
};

export function buildGreetingPrompt(opts: {
	addressName: string;
	assistantName: string;
	locale: Locale;
}): string {
	const uiLang = UI_LOCALE_NAME[opts.locale] ?? 'English';
	const who = opts.addressName || 'the user';
	return [
		`${who} is opening a new voice session with you, ${opts.assistantName} — greet ${who} warmly.`,
		'Vary your phrasing every time — never repeat a stock opening. Reference a previous',
		'conversation if you remember one worth mentioning; otherwise ask a simple, easy opening',
		`question. Reply in ${uiLang}. One or two short sentences. Plain text only — no preamble,`,
		'no quotation marks, no markdown, no emoji: this will be spoken aloud by a text-to-speech voice.'
	].join(' ');
}

function stripControlChars(value: string): string {
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
}

/** Truncate at MAX_GREETING_CHARS on a word boundary (never mid-word). */
function truncateOnWordBoundary(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * `null` for an empty/sentinel reply. Otherwise: strip control chars, collapse whitespace,
 * strip any literal `<<<`/`>>>` so the returned text can never forge a quarantine marker,
 * truncate at MAX_GREETING_CHARS on a word boundary.
 */
export function sanitizeGreetingText(raw: string): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (trimmed === HERMES_EMPTY_REPLY) return null;

	let text = stripControlChars(trimmed);
	text = text.replaceAll('<<<', '').replaceAll('>>>', '');
	text = text.replace(/\s+/g, ' ').trim();
	if (!text) return null;

	text = truncateOnWordBoundary(text, MAX_GREETING_CHARS);
	return text || null;
}
