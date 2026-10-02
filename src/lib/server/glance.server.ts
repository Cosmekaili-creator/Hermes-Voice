/**
 * Ambient-mode "glance" — a tiny, cached summary (next calendar event, unread mail count)
 * fetched from the user's own Hermes so the desk/ambient screen has something to show.
 * Pure helpers here; the route wires them to callHermesChat.
 */

export const GLANCE_TIMEOUT_MS = 30_000;
export const GLANCE_CACHE_MS = 10 * 60_000;

export type Glance = {
	nextEvent: { title: string; when?: string } | null;
	unread: number | null;
};

export const GLANCE_SYSTEM_PROMPT = [
	'You are producing a machine-readable status snapshot for an ambient display.',
	'Use only read-only calendar and email lookups. Never send, create, modify or delete anything.',
	'Reply with ONLY one JSON object and no other text.'
].join(' ');

export function buildGlancePrompt(nowIso: string): string {
	return [
		`Current time: ${nowIso}.`,
		'Return JSON exactly in this shape:',
		'{"next_event": {"title": string, "when": string} | null, "unread": number | null}',
		'next_event = the next calendar event starting after now today or tomorrow ("when" is a short',
		'human time like "14:30" or "Tomorrow 09:00"); unread = unread emails in the inbox.',
		'Use null for anything you cannot check.'
	].join(' ');
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1F\x7F-\x9F]/g;

function cleanText(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const t = value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Parse Hermes's reply defensively — first `{…}` object, every field validated. */
export function parseGlance(text: string): Glance | null {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	let nextEvent: Glance['nextEvent'] = null;
	if (o.next_event && typeof o.next_event === 'object') {
		const ev = o.next_event as Record<string, unknown>;
		const title = cleanText(ev.title, 80);
		if (title) nextEvent = { title, when: cleanText(ev.when, 40) };
	}
	const unread =
		typeof o.unread === 'number' && Number.isFinite(o.unread) && o.unread >= 0
			? Math.min(99_999, Math.floor(o.unread))
			: null;
	return { nextEvent, unread };
}
