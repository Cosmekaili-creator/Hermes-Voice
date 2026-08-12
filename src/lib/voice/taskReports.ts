/**
 * Pure, unit-testable logic for the async task-report gate. Deliberately kept OUT of
 * voiceSession.svelte.ts (which has zero test coverage in this repo) — this module owns
 * the "don't interrupt the user" logic and the report FIFO, both fully testable in
 * isolation. See taskReports.test.ts.
 */
import type { PublicTask, TaskBusEvent } from '$lib/server/tasks/types';

/** How long to let a burst of terminal task-bus events settle before auto-speaking a batch. */
export const REPORT_SETTLE_MS = 700;
/** Minimum gap between one auto-report turn ending and the next one being allowed to start,
 * for the FIRST unprompted resurfacing after the user last spoke. */
export const REPORT_COOLDOWN_MS = 45_000;
/** Cap on how many results are read out in a single report turn. */
export const MAX_REPORTS_PER_TURN = 3;
/** Cap on the concatenated result text of a batch — stop adding items past this. */
export const MAX_REPORT_ENVELOPE_CHARS = 4000;

/** Floor for the quiet pause before an unprompted resurfacing — see reportPauseMsFor(). */
export const REPORT_PAUSE_MS = 6_000;
/** Ceiling for the quiet pause before an unprompted resurfacing — see reportPauseMsFor(). */
export const MAX_REPORT_PAUSE_MS = 10_000;
/** Gap required before a SECOND (or later) unprompted resurfacing with still no word from the
 * user — much longer than REPORT_COOLDOWN_MS, see requiredReportGapMs(). */
export const UNPROMPTED_BACKOFF_MS = 120_000;
/** How many unprompted assistant turns in a row (no real user turn in between) are allowed
 * before the gate shuts until the user speaks again — caps the monologue. */
export const MAX_UNPROMPTED_REPORT_STREAK = 2;
/** Cap on how many results are read out in a single UNPROMPTED (auto) report turn — stricter
 * than MAX_REPORTS_PER_TURN, which still applies to chip/rider/launch turns. */
export const MAX_AUTO_REPORTS_PER_TURN = 1;

/** Append-if-absent by id, preserving FIFO order; update in place if the id already exists
 * (status/result may have changed since it was first merged in). */
export function mergeReports(fifo: PublicTask[], incoming: PublicTask): PublicTask[] {
	const idx = fifo.findIndex((t) => t.id === incoming.id);
	if (idx === -1) return [...fifo, incoming];
	const next = fifo.slice();
	next[idx] = incoming;
	return next;
}

/** Oldest-first (fifo is already in FIFO order), up to `max` items, stopping early if the
 * concatenated result text would exceed MAX_REPORT_ENVELOPE_CHARS. Always includes at least
 * one item (the first) even if that single item alone exceeds the cap — a batch of zero
 * would silently drop a task forever. */
export function selectBatch(fifo: PublicTask[], max: number): PublicTask[] {
	const batch: PublicTask[] = [];
	let chars = 0;
	for (const task of fifo) {
		if (batch.length >= max) break;
		const taskChars = (task.title?.length ?? 0) + (task.result?.length ?? 0);
		if (batch.length > 0 && chars + taskChars > MAX_REPORT_ENVELOPE_CHARS) break;
		batch.push(task);
		chars += taskChars;
	}
	return batch;
}

/**
 * Idempotent in-flight (queued/running) task-id bookkeeping, mutating `ids` in place. Pulled
 * out for the same reason as the rest of this module: testable in isolation. Fixes a real bug
 * where a plain integer counter over these same bus events could drift both ways —
 * double-decrement on a republished terminal event (e.g. `ack` mode `release` restoring a
 * 'reporting' record back to done/failed, or every report-turn-abandonment path that triggers
 * a release) or over-increment on a republished task.queued (reconcileStale's stale-running
 * retry). A Set add/remove by id is a no-op when the id is already present/absent, so replays
 * can never push the count negative or double-count the same task.
 */
export function applyInFlightEvent(ids: Set<string>, ev: TaskBusEvent): void {
	switch (ev.type) {
		case 'task.queued':
		case 'task.running':
			ids.add(ev.task.id);
			return;
		case 'task.done':
		case 'task.failed':
			ids.delete(ev.task.id);
			return;
		case 'task.cleared':
			for (const id of ev.ids) ids.delete(id);
			return;
		case 'task.reported':
			ids.delete(ev.id);
			return;
		case 'task.progress':
			return;
	}
}

export type ReportGateInput = {
	destroyed: boolean;
	talkMode: 'ptt' | 'handsfree';
	handsfreeArmed: boolean;
	state: 'idle' | 'listening' | 'thinking' | 'speaking';
	busy: boolean;
	hermesBridgeActive: boolean;
	userSpeechActive: boolean;
	responseMayBeActive: boolean;
	claimInFlight: boolean;
	reportTurnInFlight: boolean;
	pendingCount: number;
	lastReportTurnAt: number;
	lastAssistantTurnEndedAt: number;
	unpromptedReportStreak: number;
	pauseMs: number;
	now: number;
};

/**
 * Quiet window before an unprompted resurfacing, derived from the persona's own hands-free VAD
 * silence threshold (handsFreeSilenceMs) as a proportional floor — NOT a fixed "patient" constant.
 * Bounded at MAX_REPORT_PAUSE_MS: without a ceiling, a persona configured near the top of
 * MIN/MAX_HANDS_FREE_SILENCE_MS's range could silently reintroduce a very long wait through the
 * owner UI, which is exactly the "she never comes back" behavior this mechanism exists to fix.
 * At today's production values: default persona (1200ms) -> 6s (REPORT_PAUSE_MS dominates);
 * a persona at 3000ms -> 9s; anything above ~3333ms is clamped at the 10s ceiling.
 */
export function reportPauseMsFor(p: { handsFreeSilenceMs: number }): number {
	return Math.min(MAX_REPORT_PAUSE_MS, Math.max(REPORT_PAUSE_MS, p.handsFreeSilenceMs * 3));
}

/** Escalating gap: the first unprompted resurfacing after the user last spoke uses the normal
 *  cooldown; a second one, with still no word from the user, waits much longer. */
export function requiredReportGapMs(streak: number): number {
	return streak <= 0 ? REPORT_COOLDOWN_MS : UNPROMPTED_BACKOFF_MS;
}

/** The single highest-value predicate in this feature (per the plan) — every clause here
 * exists to prevent a specific "Hermes talks over/at the user unprompted" bug. Keep this a
 * flat conjunction so a truth table can hit each clause independently (see
 * taskReports.test.ts). */
export function shouldAutoReportNow(input: ReportGateInput): boolean {
	return (
		!input.destroyed &&
		input.talkMode === 'handsfree' &&
		input.handsfreeArmed &&
		input.state === 'listening' &&
		!input.busy &&
		!input.hermesBridgeActive &&
		!input.userSpeechActive &&
		!input.responseMayBeActive &&
		!input.claimInFlight &&
		!input.reportTurnInFlight &&
		input.pendingCount > 0 &&
		input.unpromptedReportStreak < MAX_UNPROMPTED_REPORT_STREAK &&
		input.now - input.lastAssistantTurnEndedAt >= input.pauseMs &&
		input.now - input.lastReportTurnAt >= requiredReportGapMs(input.unpromptedReportStreak)
	);
}
