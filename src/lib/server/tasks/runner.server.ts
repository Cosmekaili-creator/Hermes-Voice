/**
 * Background task runner. Mirrors routes/api/memory-review/+server.ts's shape for
 * in-flight accounting (a per-binding Map, not a single global counter, so one busy
 * binding can never starve another) and its detached-IIFE dispatch pattern.
 */
import { isHttpError } from '@sveltejs/kit';
import { extractCards, type ResultCard } from '$lib/cards';
import { getBindingById } from '$lib/server/bindings.server';
import { streamHermesChat } from '$lib/server/hermes';
import { publish } from './bus.server';
import { MAX_RUNNING_PER_BINDING, MAX_TASK_RESULT_CHARS } from './constants';
import { TASK_SYSTEM_PROMPT } from './prompts.server';
import { mutateTasks, readTasks } from './store.server';
import { toPublicTask, type TaskBusEvent, type TaskFailureCode, type TaskRecord } from './types';

/** Per-binding in-flight run count, capped at MAX_RUNNING_PER_BINDING. */
const inFlightByBinding = new Map<string, number>();

/** Exposed so /api/tasks/clear can cancel in-flight work for a task being cleared. */
export const abortByTask = new Map<string, AbortController>();

function beginRun(bindingId: string): boolean {
	const current = inFlightByBinding.get(bindingId) ?? 0;
	if (current >= MAX_RUNNING_PER_BINDING) return false;
	inFlightByBinding.set(bindingId, current + 1);
	return true;
}

function endRun(bindingId: string): void {
	const current = inFlightByBinding.get(bindingId) ?? 0;
	if (current <= 1) {
		inFlightByBinding.delete(bindingId);
	} else {
		inFlightByBinding.set(bindingId, current - 1);
	}
}

// C0 + C1 control characters — same discipline as sanitizeGreetingText/sanitizeTranscriptTurns.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F-\x9F]/g;

export function sanitizeResult(text: string): string {
	let out = text.replace(CONTROL_CHARS_RE, ' ');
	out = out.replace(/\s+/g, ' ').trim();
	if (out.length > MAX_TASK_RESULT_CHARS) {
		out = out.slice(0, MAX_TASK_RESULT_CHARS).trim();
	}
	return out;
}

/**
 * Maps a run failure to a TaskFailureCode. `streamHermesChat` throws SvelteKit HttpErrors
 * (see hermes.ts: error(499)/error(504)/error(502)/error(400)/error(500)) — those map
 * directly. Explicit catch-all: anything else (including a bare TypeError, e.g. from a
 * malformed session-id header) -> 'unavailable'. This is not theoretical: see
 * runner.server.test.ts for a test that throws a plain Error('boom') and asserts this
 * exact fallback, rather than letting it crash or fall through unclassified.
 */
export function classifyRunFailure(err: unknown): TaskFailureCode {
	if (isHttpError(err)) {
		switch (err.status) {
			case 499:
				return 'cancelled';
			case 504:
				return 'timeout';
			case 502:
				return 'upstream';
			case 400:
				return 'too_large';
			case 500:
				return 'config';
			default:
				return 'unavailable';
		}
	}
	return 'unavailable';
}

/** queued → running, atomically. False if the task is no longer queued (e.g. the user
 * cancelled it between the runner's read and this write) — the caller must then NOT run it. */
async function markRunning(bindingId: string, taskId: string): Promise<boolean> {
	const res = await mutateTasks<boolean>(bindingId, (file) => {
		const now = new Date().toISOString();
		const events: TaskBusEvent[] = [];
		let transitioned = false;
		const tasks = file.tasks.map((t) => {
			if (t.id !== taskId || t.status !== 'queued') return t;
			transitioned = true;
			const updated: TaskRecord = { ...t, status: 'running', startedAt: now, updatedAt: now };
			events.push({ type: 'task.running', task: toPublicTask(updated) });
			return updated;
		});
		return { file: { version: 1, tasks }, result: transitioned, events };
	});
	return res.ok && res.result;
}

async function markDone(
	bindingId: string,
	taskId: string,
	result: string,
	cards: ResultCard[] = []
): Promise<void> {
	await mutateTasks(bindingId, (file) => {
		const now = new Date().toISOString();
		const events: TaskBusEvent[] = [];
		const tasks = file.tasks.map((t) => {
			// 'reported' here means the user cancelled it (see /api/tasks/cancel) — a late
			// completion must not resurrect it as a report to be spoken.
			if (t.id !== taskId || t.status === 'reported') return t;
			const updated: TaskRecord = {
				...t,
				status: 'done',
				outcome: 'done',
				result,
				...(cards.length > 0 ? { cards } : {}),
				finishedAt: now,
				updatedAt: now
			};
			events.push({ type: 'task.done', task: toPublicTask(updated) });
			return updated;
		});
		return { file: { version: 1, tasks }, result: undefined, events };
	});
}

async function markFailed(
	bindingId: string,
	taskId: string,
	failureCode: TaskFailureCode
): Promise<void> {
	await mutateTasks(bindingId, (file) => {
		const now = new Date().toISOString();
		const events: TaskBusEvent[] = [];
		const tasks = file.tasks.map((t) => {
			// 'reported' here means the user cancelled it (see /api/tasks/cancel) — a late
			// completion must not resurrect it as a report to be spoken.
			if (t.id !== taskId || t.status === 'reported') return t;
			const updated: TaskRecord = {
				...t,
				status: 'failed',
				outcome: 'failed',
				failureCode,
				finishedAt: now,
				updatedAt: now
			};
			events.push({ type: 'task.failed', task: toPublicTask(updated) });
			return updated;
		});
		return { file: { version: 1, tasks }, result: undefined, events };
	});
}

/**
 * Runs one task end to end. Exported (rather than kept private) so tests can drive it
 * directly with mocked dependencies — in particular to prove the in-flight counter never
 * leaks after an unexpected (non-HttpError) throw from a dependency such as
 * getBindingById, which is exactly the wedge scenario MAX_RUNNING_PER_BINDING=1 makes
 * dangerous if endRun() is ever skipped.
 */
export async function runTask(bindingId: string, taskId: string): Promise<void> {
	if (!beginRun(bindingId)) return; // at cap, no-op — stays queued, picked up when the cap frees
	const ac = new AbortController();
	abortByTask.set(taskId, ac);
	try {
		const binding = await getBindingById(bindingId);
		if (!binding) {
			await markFailed(bindingId, taskId, 'binding_missing');
			return;
		}
		if (!binding.enabled) {
			await markFailed(bindingId, taskId, 'binding_disabled');
			return;
		}
		if (!binding.hermesApiKey?.trim()) {
			await markFailed(bindingId, taskId, 'config');
			return;
		}

		const read = await readTasks(bindingId);
		const record = read.ok ? read.file.tasks.find((t) => t.id === taskId) : undefined;
		if (!record || record.status !== 'queued') return; // vanished (pruned/cleared) or already handled

		if (!(await markRunning(bindingId, taskId))) return; // cancelled meanwhile — never run it
		if (ac.signal.aborted) return;
		const { text } = await streamHermesChat({
			request: record.request,
			sessionId: `${taskId}:task`, // namespaced, like memory-review's `:review` suffix — never
			// lands in the live conversation thread
			hermesApiBase: binding.hermesApiBase,
			hermesApiKey: binding.hermesApiKey,
			hermesSessionKey: binding.hermesSessionKey,
			systemPrompt: TASK_SYSTEM_PROMPT,
			signal: ac.signal,
			onToolProgress: (p) =>
				publish(bindingId, { type: 'task.progress', id: taskId, tool: p.tool, label: p.label })
		});
		// Display cards are split off before sanitizing: the voice model only ever gets the
		// spoken text, never the JSON block.
		const split = extractCards(text);
		await markDone(bindingId, taskId, sanitizeResult(split.text), split.cards);
	} catch (err) {
		await markFailed(bindingId, taskId, classifyRunFailure(err)).catch((e) =>
			console.error('markFailed threw', e)
		);
		// The outer catch around markFailed itself matters: if marking-failed throws, we
		// must not let that skip the finally block below — that's exactly the
		// counter-leak bug this function exists to avoid.
	} finally {
		abortByTask.delete(taskId);
		// THIS IS THE CRITICAL LINE. Without it, one unexpected throw +
		// MAX_RUNNING_PER_BINDING=1 permanently wedges this binding's entire queue until
		// process restart. Must run unconditionally regardless of what happened above.
		endRun(bindingId);
		scheduleBinding(bindingId); // drain the next queued task, if any
	}
}

/**
 * Idempotent "poke" — call after any dispatch/reconcile that might have new queued work.
 * Picks the oldest queued task and runs it if under the cap, else no-ops.
 */
export function scheduleBinding(bindingId: string): void {
	void (async () => {
		const current = inFlightByBinding.get(bindingId) ?? 0;
		if (current >= MAX_RUNNING_PER_BINDING) return;

		const read = await readTasks(bindingId);
		if (!read.ok) return;

		const queued = read.file.tasks
			.filter((t) => t.status === 'queued')
			.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
		const next = queued[0];
		if (!next) return;

		void runTask(bindingId, next.id);
	})();
}
