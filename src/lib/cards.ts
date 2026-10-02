/**
 * Rich result cards — structured data Hermes may attach to a task result so the Lounge
 * can SHOW it (calendar events, emails, links, contacts) while the voice model only SPEAKS
 * the plain text. Shared by server (extraction at task completion) and client (rendering).
 *
 * Wire format: Hermes ends its reply with one fenced block
 *
 *     ```hv-cards
 *     [{"type":"event","title":"Design review","when":"Tue 14:30–15:15","where":"Room 4B"}]
 *     ```
 *
 * Everything in the block is untrusted model output: it is parsed defensively, every
 * field is length-capped plain text (rendered as text, never HTML), and link URLs must be
 * absolute http(s). Anything malformed is dropped silently — cards are a nice-to-have.
 */

export type ResultCard =
	| { type: 'event'; title: string; when?: string; where?: string }
	| { type: 'email'; title: string; from?: string; to?: string; snippet?: string }
	| { type: 'link'; title: string; url: string; detail?: string }
	| { type: 'contact'; title: string; detail?: string }
	| { type: 'note'; title: string; detail?: string };

export const MAX_CARDS = 6;
const MAX_TITLE = 120;
const MAX_FIELD = 240;

const FENCE_RE = /```hv-cards\s*\n([\s\S]*?)```/i;

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1F\x7F-\x9F]/g;

function clean(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const text = value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
	if (!text) return undefined;
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function safeUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
		if (url.username || url.password) return undefined;
		return url.href.length <= 2048 ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export function sanitizeCard(raw: unknown): ResultCard | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const o = raw as Record<string, unknown>;
	const title = clean(o.title, MAX_TITLE);
	if (!title) return null;
	switch (o.type) {
		case 'event':
			return {
				type: 'event',
				title,
				when: clean(o.when, MAX_FIELD),
				where: clean(o.where, MAX_FIELD)
			};
		case 'email':
			return {
				type: 'email',
				title,
				from: clean(o.from, MAX_FIELD),
				to: clean(o.to, MAX_FIELD),
				snippet: clean(o.snippet, MAX_FIELD)
			};
		case 'link': {
			const url = safeUrl(o.url);
			if (!url) return null;
			return { type: 'link', title, url, detail: clean(o.detail, MAX_FIELD) };
		}
		case 'contact':
			return { type: 'contact', title, detail: clean(o.detail, MAX_FIELD) };
		case 'note':
			return { type: 'note', title, detail: clean(o.detail, MAX_FIELD) };
		default:
			return null;
	}
}

export function sanitizeCards(raw: unknown): ResultCard[] {
	if (!Array.isArray(raw)) return [];
	const out: ResultCard[] = [];
	for (const item of raw) {
		const card = sanitizeCard(item);
		if (card) out.push(card);
		if (out.length >= MAX_CARDS) break;
	}
	return out;
}

/** Strip compact JSON-free undefined keys so stored records stay small. */
function compact(card: ResultCard): ResultCard {
	return Object.fromEntries(Object.entries(card).filter(([, v]) => v !== undefined)) as ResultCard;
}

/**
 * Split a Hermes reply into the text to speak and any cards. The fenced block is always
 * removed from the spoken text, even when it fails to parse (never read JSON aloud).
 */
export function extractCards(text: string): { text: string; cards: ResultCard[] } {
	const match = FENCE_RE.exec(text);
	if (!match) return { text, cards: [] };
	const spoken = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
	try {
		return { text: spoken, cards: sanitizeCards(JSON.parse(match[1] ?? '')).map(compact) };
	} catch {
		return { text: spoken, cards: [] };
	}
}

/** Appended to Hermes task prompts so it knows it MAY attach cards. */
export const CARDS_PROMPT_HINT = [
	'Optional display cards: when your answer contains calendar events, emails, links, or contacts,',
	'you may end your reply with ONE fenced block tagged hv-cards holding a JSON array (max 6) of',
	'objects, each one of: {"type":"event","title","when","where"}, {"type":"email","title","from",',
	'"to","snippet"}, {"type":"link","title","url","detail"}, {"type":"contact","title","detail"},',
	'{"type":"note","title","detail"}. Short plain-text values only. The block is shown on screen,',
	'never read aloud — the text before it must still stand on its own as the spoken answer.'
].join(' ');
