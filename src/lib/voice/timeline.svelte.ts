/**
 * Conversation timeline — the persistent, scrollable record behind the Lounge's bottom
 * sheet: what was said (both sides), what Hermes did, task outcomes, approvals and result
 * cards. Captions stay ephemeral; this is the durable view.
 *
 * Persistence is per browser (localStorage), capped, and clearable from the sheet. It is
 * the user's own device and conversation; nothing here is sent anywhere.
 */
import { sanitizeCards, type ResultCard } from '$lib/cards';

export type TimelineTaskStatus = 'queued' | 'running' | 'done' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'declined';

type Base = { id: string; at: number };

export type TimelineEntry =
	| (Base & { kind: 'user'; text: string; via: 'voice' | 'text' })
	| (Base & { kind: 'assistant'; text: string })
	| (Base & { kind: 'tool'; label: string })
	| (Base & { kind: 'task'; taskId: string; title: string; status: TimelineTaskStatus })
	| (Base & { kind: 'approval'; approvalId: string; summary: string; status: ApprovalStatus })
	| (Base & { kind: 'cards'; cards: ResultCard[] });

/** Distributive Omit so each union member keeps its own fields. */
export type NewTimelineEntry = TimelineEntry extends infer E
	? E extends TimelineEntry
		? Omit<E, 'id' | 'at'>
		: never
	: never;

export const TIMELINE_STORAGE_KEY = 'hermes-voice.timeline.v1';
export const MAX_TIMELINE_ENTRIES = 300;
const MAX_TEXT = 4000;

function capText(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

/** Validate one stored entry — localStorage is user-writable, never trust its shape. */
export function reviveEntry(raw: unknown): TimelineEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const id = typeof o.id === 'string' ? o.id.slice(0, 64) : '';
	const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
	if (!id || !at) return null;
	switch (o.kind) {
		case 'user': {
			const text = capText(o.text);
			return text ? { id, at, kind: 'user', text, via: o.via === 'text' ? 'text' : 'voice' } : null;
		}
		case 'assistant': {
			const text = capText(o.text);
			return text ? { id, at, kind: 'assistant', text } : null;
		}
		case 'tool': {
			const label = capText(o.label).slice(0, 200);
			return label ? { id, at, kind: 'tool', label } : null;
		}
		case 'task': {
			const status = o.status;
			if (status !== 'queued' && status !== 'running' && status !== 'done' && status !== 'failed')
				return null;
			const taskId = typeof o.taskId === 'string' ? o.taskId.slice(0, 64) : '';
			if (!taskId) return null;
			return { id, at, kind: 'task', taskId, title: capText(o.title).slice(0, 120), status };
		}
		case 'approval': {
			const status = o.status;
			if (status !== 'pending' && status !== 'approved' && status !== 'declined') return null;
			const approvalId = typeof o.approvalId === 'string' ? o.approvalId.slice(0, 64) : '';
			if (!approvalId) return null;
			// A pending approval can't survive a reload (its tool call is gone) — show it as declined.
			return {
				id,
				at,
				kind: 'approval',
				approvalId,
				summary: capText(o.summary).slice(0, 300),
				status: status === 'pending' ? 'declined' : status
			};
		}
		case 'cards': {
			const cards = sanitizeCards(o.cards);
			return cards.length > 0 ? { id, at, kind: 'cards', cards } : null;
		}
		default:
			return null;
	}
}

function readStored(): TimelineEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(TIMELINE_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const out: TimelineEntry[] = [];
		for (const item of parsed) {
			const e = reviveEntry(item);
			if (e) out.push(e);
		}
		return out.slice(-MAX_TIMELINE_ENTRIES);
	} catch {
		return [];
	}
}

function writeStored(entries: TimelineEntry[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(entries));
	} catch {
		/* quota / private mode — the in-memory timeline still works */
	}
}

let idCounter = 0;
function newId(): string {
	idCounter += 1;
	return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Plain-text label for search + export (kept pure so it is unit-testable). */
export function entryText(e: TimelineEntry): string {
	switch (e.kind) {
		case 'user':
		case 'assistant':
			return e.text;
		case 'tool':
			return e.label;
		case 'task':
			return `${e.title} (${e.status})`;
		case 'approval':
			return `${e.summary} (${e.status})`;
		case 'cards':
			return e.cards
				.map((c) => [c.title, 'url' in c ? c.url : '', 'when' in c ? (c.when ?? '') : ''].join(' '))
				.join(' · ');
	}
}

export function filterEntries(entries: TimelineEntry[], query: string): TimelineEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return entries;
	return entries.filter((e) => entryText(e).toLowerCase().includes(q));
}

export function exportTimelineText(
	entries: TimelineEntry[],
	labels: { you: string; assistant: string }
): string {
	return entries
		.map((e) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off formatting, not state
			const ts = new Date(e.at).toISOString().replace('T', ' ').slice(0, 16);
			const who =
				e.kind === 'user' ? labels.you : e.kind === 'assistant' ? labels.assistant : `· ${e.kind}`;
			return `[${ts}] ${who}: ${entryText(e)}`;
		})
		.join('\n');
}

export function createTimeline(opts: { persist?: boolean } = {}) {
	const persist = opts.persist !== false;
	let entries = $state<TimelineEntry[]>(persist ? readStored() : []);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleSave() {
		if (!persist) return;
		if (saveTimer !== null) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			writeStored(entries);
		}, 400);
	}

	function commit(next: TimelineEntry[]) {
		entries = next.length > MAX_TIMELINE_ENTRIES ? next.slice(-MAX_TIMELINE_ENTRIES) : next;
		scheduleSave();
	}

	function add(entry: NewTimelineEntry): string {
		const id = newId();
		commit([...entries, { ...entry, id, at: Date.now() } as TimelineEntry]);
		return id;
	}

	/** One row per task id — status changes update it in place. */
	function upsertTask(taskId: string, title: string, status: TimelineTaskStatus) {
		const idx = entries.findIndex((e) => e.kind === 'task' && e.taskId === taskId);
		if (idx < 0) {
			add({ kind: 'task', taskId, title, status });
			return;
		}
		const cur = entries[idx] as Extract<TimelineEntry, { kind: 'task' }>;
		if (cur.status === status && cur.title === title) return;
		const next = entries.slice();
		next[idx] = { ...cur, title: title || cur.title, status };
		commit(next);
	}

	function setApproval(approvalId: string, status: ApprovalStatus) {
		const idx = entries.findIndex((e) => e.kind === 'approval' && e.approvalId === approvalId);
		if (idx < 0) return;
		const next = entries.slice();
		next[idx] = { ...(entries[idx] as Extract<TimelineEntry, { kind: 'approval' }>), status };
		commit(next);
	}

	/** Live-updating text (user speech transcription arrives incrementally). */
	function updateText(id: string, text: string) {
		const idx = entries.findIndex((e) => e.id === id);
		if (idx < 0) return;
		const cur = entries[idx]!;
		if (cur.kind !== 'user' && cur.kind !== 'assistant') return;
		if (cur.text === text) return;
		const next = entries.slice();
		next[idx] = { ...cur, text: text.slice(0, MAX_TEXT) };
		commit(next);
	}

	/** Collapse consecutive identical tool labels (Hermes repeats progress events). */
	function addTool(label: string) {
		const last = entries[entries.length - 1];
		if (last && last.kind === 'tool' && last.label === label) return;
		add({ kind: 'tool', label });
	}

	function clear() {
		entries = [];
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (persist && typeof localStorage !== 'undefined') {
			try {
				localStorage.removeItem(TIMELINE_STORAGE_KEY);
			} catch {
				/* ignore */
			}
		}
	}

	return {
		get entries() {
			return entries;
		},
		add,
		addTool,
		updateText,
		upsertTask,
		setApproval,
		clear
	};
}

export type Timeline = ReturnType<typeof createTimeline>;
