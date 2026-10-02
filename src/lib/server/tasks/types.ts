/**
 * Async Hermes task-queue data model. Server-only.
 *
 * Deliberately NO `bindingId` field on `TaskRecord` — the binding a task belongs to is
 * identified purely by which per-binding file it lives in (see store.server.ts). This is
 * load-bearing: it means a written task file can never itself contain a value that, if it
 * leaked, would let one binding's tasks be replayed against another binding's credentials.
 */

import type { ResultCard } from '$lib/cards';

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'reporting' | 'reported';
export type TaskOutcome = 'done' | 'failed' | null;
export type TaskFailureCode =
	| 'timeout'
	| 'upstream'
	| 'cancelled'
	| 'binding_disabled'
	| 'binding_missing'
	| 'config'
	| 'too_large'
	| 'unavailable';

export type TaskRecord = {
	id: string; // randomUUID
	title: string; // model-authored, <=80 chars, sanitized — spoken aloud
	request: string; // sanitized brief sent to Hermes
	status: TaskStatus;
	outcome: TaskOutcome; // set once terminal; PRESERVED through reporting/reported
	result?: string; // present only between terminal and confirm — dropped on ack
	cards?: ResultCard[]; // display-only result cards (see $lib/cards) — dropped with result
	failureCode?: TaskFailureCode;
	runAttempts: number; // crash-resume counter, cap MAX_RUN_ATTEMPTS
	attempts: number; // SPOKEN-report attempts, cap MAX_REPORT_ATTEMPTS
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
	claimedAt?: string;
	reportedAt?: string;
};

export type TasksFile = { version: 1; tasks: TaskRecord[] };

/** DTO sent to the browser — never includes bindingId (TaskRecord has none anyway), never
 * includes `request` (the sanitized-but-still-potentially-sensitive brief). */
export type PublicTask = Pick<
	TaskRecord,
	| 'id'
	| 'title'
	| 'status'
	| 'outcome'
	| 'result'
	| 'cards'
	| 'failureCode'
	| 'createdAt'
	| 'updatedAt'
	| 'startedAt'
	| 'finishedAt'
	| 'claimedAt'
	| 'reportedAt'
>;

export type TaskBusEvent =
	| { type: 'task.queued'; task: PublicTask }
	| { type: 'task.running'; task: PublicTask }
	| { type: 'task.progress'; id: string; tool: string; label?: string }
	| { type: 'task.done'; task: PublicTask }
	| { type: 'task.failed'; task: PublicTask }
	| { type: 'task.reported'; id: string }
	| { type: 'task.cleared'; ids: string[] };

export function toPublicTask(t: TaskRecord): PublicTask {
	return {
		id: t.id,
		title: t.title,
		status: t.status,
		outcome: t.outcome,
		result: t.result,
		...(t.cards && t.cards.length > 0 ? { cards: t.cards } : {}),
		failureCode: t.failureCode,
		createdAt: t.createdAt,
		updatedAt: t.updatedAt,
		startedAt: t.startedAt,
		finishedAt: t.finishedAt,
		claimedAt: t.claimedAt,
		reportedAt: t.reportedAt
	};
}
