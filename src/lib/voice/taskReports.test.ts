import { describe, expect, it } from 'vitest';
import type { PublicTask, TaskBusEvent } from '$lib/server/tasks/types';
import {
	applyInFlightEvent,
	MAX_REPORT_ENVELOPE_CHARS,
	MAX_REPORT_PAUSE_MS,
	MAX_UNPROMPTED_REPORT_STREAK,
	mergeReports,
	REPORT_COOLDOWN_MS,
	REPORT_PAUSE_MS,
	reportPauseMsFor,
	requiredReportGapMs,
	selectBatch,
	shouldAutoReportNow,
	UNPROMPTED_BACKOFF_MS,
	type ReportGateInput
} from './taskReports';

function task(id: string, overrides: Partial<PublicTask> = {}): PublicTask {
	return {
		id,
		title: `Task ${id}`,
		status: 'done',
		outcome: 'done',
		result: 'ok',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('mergeReports', () => {
	it('appends a new id at the end, preserving FIFO order', () => {
		const fifo = [task('a'), task('b')];
		const next = mergeReports(fifo, task('c'));
		expect(next.map((t) => t.id)).toEqual(['a', 'b', 'c']);
	});

	it('updates in place when the id already exists, without reordering', () => {
		const fifo = [task('a', { status: 'done' }), task('b'), task('c')];
		const updated = task('a', { status: 'failed', outcome: 'failed', failureCode: 'timeout' });
		const next = mergeReports(fifo, updated);
		expect(next.map((t) => t.id)).toEqual(['a', 'b', 'c']);
		expect(next[0]).toEqual(updated);
	});

	it('does not mutate the input array', () => {
		const fifo = [task('a')];
		const frozen = [...fifo];
		mergeReports(fifo, task('b'));
		expect(fifo).toEqual(frozen);
	});
});

describe('selectBatch', () => {
	it('returns oldest-first, up to max items', () => {
		const fifo = [task('a'), task('b'), task('c'), task('d')];
		expect(selectBatch(fifo, 3).map((t) => t.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns fewer than max when the fifo is shorter', () => {
		const fifo = [task('a')];
		expect(selectBatch(fifo, 3).map((t) => t.id)).toEqual(['a']);
	});

	it('returns empty for an empty fifo', () => {
		expect(selectBatch([], 3)).toEqual([]);
	});

	it('stops early once the concatenated text would exceed the char cap', () => {
		const big = 'x'.repeat(MAX_REPORT_ENVELOPE_CHARS - 10);
		const fifo = [task('a', { result: big }), task('b', { result: 'y'.repeat(50) }), task('c')];
		const batch = selectBatch(fifo, 3);
		expect(batch.map((t) => t.id)).toEqual(['a']);
	});

	it('always includes at least one item even if it alone exceeds the cap', () => {
		const huge = 'x'.repeat(MAX_REPORT_ENVELOPE_CHARS + 500);
		const fifo = [task('a', { result: huge }), task('b')];
		const batch = selectBatch(fifo, 3);
		expect(batch.map((t) => t.id)).toEqual(['a']);
	});
});

describe('shouldAutoReportNow', () => {
	function baseInput(): ReportGateInput {
		return {
			destroyed: false,
			talkMode: 'handsfree',
			handsfreeArmed: true,
			state: 'listening',
			busy: false,
			hermesBridgeActive: false,
			userSpeechActive: false,
			responseMayBeActive: false,
			claimInFlight: false,
			reportTurnInFlight: false,
			pendingCount: 1,
			lastReportTurnAt: 0,
			// Far enough in the past (relative to `now: 100_000`) that the pause window and the
			// streak-0 cooldown are both already satisfied by default — individual tests below
			// override these to probe the boundaries.
			lastAssistantTurnEndedAt: 0,
			unpromptedReportStreak: 0,
			pauseMs: REPORT_PAUSE_MS,
			now: 100_000
		};
	}

	it('is true when every gate condition holds', () => {
		expect(shouldAutoReportNow(baseInput())).toBe(true);
	});

	// Truth table: flip exactly one clause false at a time — every single one must veto.
	it('is false when destroyed', () => {
		expect(shouldAutoReportNow({ ...baseInput(), destroyed: true })).toBe(false);
	});

	it('is false in PTT mode', () => {
		expect(shouldAutoReportNow({ ...baseInput(), talkMode: 'ptt' })).toBe(false);
	});

	it('is false when hands-free is not armed', () => {
		expect(shouldAutoReportNow({ ...baseInput(), handsfreeArmed: false })).toBe(false);
	});

	it('is false when not in the listening state', () => {
		expect(shouldAutoReportNow({ ...baseInput(), state: 'thinking' })).toBe(false);
	});

	it('is false when busy', () => {
		expect(shouldAutoReportNow({ ...baseInput(), busy: true })).toBe(false);
	});

	it('is false when the legacy Hermes bridge is active', () => {
		expect(shouldAutoReportNow({ ...baseInput(), hermesBridgeActive: true })).toBe(false);
	});

	it('is false while the user is mid-utterance', () => {
		expect(shouldAutoReportNow({ ...baseInput(), userSpeechActive: true })).toBe(false);
	});

	it('is false while a response may still be active', () => {
		expect(shouldAutoReportNow({ ...baseInput(), responseMayBeActive: true })).toBe(false);
	});

	it('is false while a claim is in flight', () => {
		expect(shouldAutoReportNow({ ...baseInput(), claimInFlight: true })).toBe(false);
	});

	it('is false while a report turn is already in flight', () => {
		expect(shouldAutoReportNow({ ...baseInput(), reportTurnInFlight: true })).toBe(false);
	});

	it('is false when there is nothing pending', () => {
		expect(shouldAutoReportNow({ ...baseInput(), pendingCount: 0 })).toBe(false);
	});

	it('is false during the cooldown window after the last report turn', () => {
		expect(shouldAutoReportNow({ ...baseInput(), lastReportTurnAt: 99_000, now: 100_000 })).toBe(
			false
		);
	});

	it('is true exactly at the cooldown boundary (streak 0, i.e. REPORT_COOLDOWN_MS)', () => {
		expect(shouldAutoReportNow({ ...baseInput(), lastReportTurnAt: 55_000, now: 100_000 })).toBe(
			true
		);
	});

	// Streak-cap boundary. lastReportTurnAt is pushed far into the past so the (streak-scaled)
	// gap requirement is trivially satisfied and only the streak clause itself is on trial.
	it('is true at streak = MAX_UNPROMPTED_REPORT_STREAK - 1 (still allowed)', () => {
		expect(
			shouldAutoReportNow({
				...baseInput(),
				lastReportTurnAt: -1_000_000,
				unpromptedReportStreak: MAX_UNPROMPTED_REPORT_STREAK - 1
			})
		).toBe(true);
	});

	it('is false once the unprompted streak reaches MAX_UNPROMPTED_REPORT_STREAK', () => {
		expect(
			shouldAutoReportNow({
				...baseInput(),
				lastReportTurnAt: -1_000_000,
				unpromptedReportStreak: MAX_UNPROMPTED_REPORT_STREAK
			})
		).toBe(false);
	});

	// Pause-window boundary (reportPauseMsFor's output, threaded in as `pauseMs`).
	it('is false one millisecond short of the pause window', () => {
		const now = 100_000;
		expect(
			shouldAutoReportNow({
				...baseInput(),
				now,
				lastAssistantTurnEndedAt: now - (REPORT_PAUSE_MS - 1)
			})
		).toBe(false);
	});

	it('is true exactly at the pause-window boundary', () => {
		const now = 100_000;
		expect(
			shouldAutoReportNow({
				...baseInput(),
				now,
				lastAssistantTurnEndedAt: now - REPORT_PAUSE_MS
			})
		).toBe(true);
	});

	// Escalating-gap boundary (requiredReportGapMs).
	it('streak 0: is true exactly at REPORT_COOLDOWN_MS since the last report turn', () => {
		const now = 100_000;
		expect(
			shouldAutoReportNow({
				...baseInput(),
				now,
				unpromptedReportStreak: 0,
				lastReportTurnAt: now - REPORT_COOLDOWN_MS
			})
		).toBe(true);
	});

	it('streak 1: is false at REPORT_COOLDOWN_MS since the last report turn — needs the longer backoff', () => {
		const now = 100_000;
		expect(
			shouldAutoReportNow({
				...baseInput(),
				now,
				unpromptedReportStreak: 1,
				lastReportTurnAt: now - REPORT_COOLDOWN_MS
			})
		).toBe(false);
	});

	it('streak 1: is true exactly at UNPROMPTED_BACKOFF_MS since the last report turn', () => {
		const now = 100_000;
		expect(
			shouldAutoReportNow({
				...baseInput(),
				now,
				unpromptedReportStreak: 1,
				lastReportTurnAt: now - UNPROMPTED_BACKOFF_MS
			})
		).toBe(true);
	});

	// Property-style regression: "the monologue cannot come back" — once a report turn has
	// started (streak -> 1), no amount of pure silence before UNPROMPTED_BACKOFF_MS has
	// elapsed reopens the gate, and once the streak is capped, no amount of silence ever
	// reopens it (only a real user turn — outside this pure function — resets the streak).
	it('property: no now before T + UNPROMPTED_BACKOFF_MS reopens the gate after a streak -> 1 report turn', () => {
		const T = 1_000_000;
		for (let deltaMs = 0; deltaMs < UNPROMPTED_BACKOFF_MS; deltaMs += 5_000) {
			const now = T + deltaMs;
			expect(
				shouldAutoReportNow({
					...baseInput(),
					now,
					unpromptedReportStreak: 1,
					lastReportTurnAt: T,
					lastAssistantTurnEndedAt: T
				})
			).toBe(false);
		}
	});

	it('property: no now ever reopens the gate once the unprompted streak is capped', () => {
		const T = 1_000_000;
		for (let deltaMs = 0; deltaMs <= 10 * UNPROMPTED_BACKOFF_MS; deltaMs += UNPROMPTED_BACKOFF_MS) {
			const now = T + deltaMs;
			expect(
				shouldAutoReportNow({
					...baseInput(),
					now,
					unpromptedReportStreak: MAX_UNPROMPTED_REPORT_STREAK,
					lastReportTurnAt: T,
					lastAssistantTurnEndedAt: T
				})
			).toBe(false);
		}
	});
});

describe('reportPauseMsFor', () => {
	it('floors at REPORT_PAUSE_MS for a short hands-free silence threshold (1200ms -> 6000ms)', () => {
		expect(reportPauseMsFor({ handsFreeSilenceMs: 1200 })).toBe(6_000);
		expect(reportPauseMsFor({ handsFreeSilenceMs: 1200 })).toBe(REPORT_PAUSE_MS);
	});

	it('scales proportionally within the floor/ceiling band (3000ms -> 9000ms)', () => {
		expect(reportPauseMsFor({ handsFreeSilenceMs: 3000 })).toBe(9_000);
	});

	it('clamps at MAX_REPORT_PAUSE_MS for a high hands-free silence threshold (15000ms -> 10000ms)', () => {
		expect(reportPauseMsFor({ handsFreeSilenceMs: 15_000 })).toBe(10_000);
		expect(reportPauseMsFor({ handsFreeSilenceMs: 15_000 })).toBe(MAX_REPORT_PAUSE_MS);
	});
});

describe('requiredReportGapMs', () => {
	it('streak 0 (or negative) requires REPORT_COOLDOWN_MS', () => {
		expect(requiredReportGapMs(0)).toBe(REPORT_COOLDOWN_MS);
		expect(requiredReportGapMs(-1)).toBe(REPORT_COOLDOWN_MS);
	});

	it('streak >= 1 requires the much longer UNPROMPTED_BACKOFF_MS', () => {
		expect(requiredReportGapMs(1)).toBe(UNPROMPTED_BACKOFF_MS);
		expect(requiredReportGapMs(2)).toBe(UNPROMPTED_BACKOFF_MS);
	});
});

describe('applyInFlightEvent', () => {
	function queued(id: string): TaskBusEvent {
		return { type: 'task.queued', task: task(id, { status: 'queued', outcome: null }) };
	}
	function done(id: string): TaskBusEvent {
		return { type: 'task.done', task: task(id, { status: 'done' }) };
	}
	function failedEv(id: string): TaskBusEvent {
		return { type: 'task.failed', task: task(id, { status: 'failed', outcome: 'failed' }) };
	}

	it('adds an id on task.queued', () => {
		const ids = new Set<string>();
		applyInFlightEvent(ids, queued('a'));
		expect([...ids]).toEqual(['a']);
	});

	it('task.running also adds (idempotent), not assuming task.queued already ran for this id', () => {
		const ids = new Set<string>();
		applyInFlightEvent(ids, { type: 'task.running', task: task('a', { status: 'running' }) });
		expect([...ids]).toEqual(['a']);
	});

	it('a republished task.queued for an id already tracked is a no-op, not an over-count', () => {
		// Regression for the old integer-counter bug: reconcileStale's stale-running retry
		// republishes task.queued for a task already counted in flight — with a raw counter
		// this over-increments; with a Set, adding an already-present id changes nothing.
		const ids = new Set<string>(['a']);
		applyInFlightEvent(ids, queued('a'));
		expect(ids.size).toBe(1);
	});

	it('removes an id on task.done / task.failed', () => {
		const ids = new Set<string>(['a', 'b']);
		applyInFlightEvent(ids, done('a'));
		expect([...ids]).toEqual(['b']);
		applyInFlightEvent(ids, failedEv('b'));
		expect(ids.size).toBe(0);
	});

	it('a terminal event republished for an already-removed id never goes negative', () => {
		// Regression for the old integer-counter bug: every report-turn-abandonment path
		// (fail/failRaw/interruptSpeaking/confirmCancelHermes/setTalkMode/destroy/the error
		// handler) triggers an `ack` mode 'release', which republishes task.done/task.failed
		// for a task whose terminal event was already counted once — a raw counter would
		// double-decrement (potentially below zero); a Set's removal of an absent id is a
		// pure no-op, so size can never go negative or drift from reality.
		const ids = new Set<string>(['a']);
		applyInFlightEvent(ids, done('a'));
		expect(ids.size).toBe(0);
		applyInFlightEvent(ids, done('a'));
		expect(ids.size).toBe(0);
	});

	it('removes every id in a task.cleared batch, leaving untracked ids alone', () => {
		const ids = new Set<string>(['a', 'b', 'c']);
		applyInFlightEvent(ids, { type: 'task.cleared', ids: ['a', 'c', 'not-tracked'] });
		expect([...ids]).toEqual(['b']);
	});

	it('removes an id on task.reported', () => {
		const ids = new Set<string>(['a']);
		applyInFlightEvent(ids, { type: 'task.reported', id: 'a' });
		expect(ids.size).toBe(0);
	});

	it('task.progress has no effect on in-flight tracking', () => {
		const ids = new Set<string>(['a']);
		applyInFlightEvent(ids, { type: 'task.progress', id: 'a', tool: 'search' });
		expect([...ids]).toEqual(['a']);
	});
});
