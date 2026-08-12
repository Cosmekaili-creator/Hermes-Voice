/**
 * Per-binding async task store. One JSON file per binding: `<TASKS_DIR>/<bindingId>.json`.
 *
 * Single-process assumption (load-bearing, read before touching this file): this store
 * assumes a SINGLE Node process (confirmed: `deploy/hermes-voice.service` has one
 * `ExecStart`, no clustering). The in-process `mutateTasks` mutex below is a *sufficient*
 * lock only under that assumption — it serializes writers within this process, nothing
 * more. If multi-process is ever introduced, this needs a real file lock (e.g. `O_EXCL`),
 * not a bigger interval poll. Do not add any cross-process coordination here — it would be
 * unused complexity for a single-instance deployment.
 *
 * Durability note: writes go through the same temp-file/fsync/rename discipline as
 * `writeBindingsAtomic` (bindings.server.ts) — file contents are fsynced and the rename is
 * atomic within the directory. The rename itself is NOT fsync'd to the directory, so this
 * does not claim full crash-durability beyond what `writeBindingsAtomic` already provides
 * (a crash between rename() returning and the directory entry hitting disk could in theory
 * lose the very last write on some filesystems/power-loss scenarios — an accepted,
 * pre-existing tradeoff, not a new one introduced here).
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { publish } from './bus.server';
import {
	MAX_RUN_ATTEMPTS,
	MAX_REPORT_ATTEMPTS,
	REPORT_CLAIM_TTL_MS,
	RUN_STALE_MS,
	TASK_RETENTION_REPORTED_MS,
	TASK_RETENTION_UNREPORTED_MS
} from './constants';
import {
	toPublicTask,
	type TaskBusEvent,
	type TaskFailureCode,
	type TaskRecord,
	type TaskStatus,
	type TasksFile
} from './types';

/**
 * Binding ids come from an owner-editable JSON file (`data/bindings.json`) — this is real
 * path-traversal defense, not cosmetic validation. Any id that doesn't match MUST be
 * rejected outright before any `path.join` call — never silently fall back to a default
 * path.
 */
export const SAFE_BINDING_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function tasksDir(): string {
	const fromEnv = readEnvTrimmed('TASKS_DIR');
	if (fromEnv) return path.resolve(fromEnv);
	return path.join(process.cwd(), 'data', 'tasks');
}

function taskFilePath(bindingId: string): string {
	return path.join(tasksDir(), `${bindingId}.json`);
}

const VALID_STATUSES = new Set<TaskStatus>([
	'queued',
	'running',
	'done',
	'failed',
	'reporting',
	'reported'
]);

const VALID_FAILURE_CODES = new Set<TaskFailureCode>([
	'timeout',
	'upstream',
	'cancelled',
	'binding_disabled',
	'binding_missing',
	'config',
	'too_large',
	'unavailable'
]);

function normalizeTaskRecord(raw: unknown): TaskRecord | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const id = typeof o.id === 'string' ? o.id : '';
	const title = typeof o.title === 'string' ? o.title : '';
	const request = typeof o.request === 'string' ? o.request : '';
	const status =
		typeof o.status === 'string' && VALID_STATUSES.has(o.status as TaskStatus)
			? (o.status as TaskStatus)
			: null;
	if (!id || !title || !request || !status) return null;

	const outcome = o.outcome === 'done' || o.outcome === 'failed' ? o.outcome : null;
	const runAttempts =
		typeof o.runAttempts === 'number' && Number.isFinite(o.runAttempts) ? o.runAttempts : 0;
	const attempts = typeof o.attempts === 'number' && Number.isFinite(o.attempts) ? o.attempts : 0;
	const createdAt = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString();
	const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : createdAt;

	const record: TaskRecord = {
		id,
		title,
		request,
		status,
		outcome,
		runAttempts,
		attempts,
		createdAt,
		updatedAt
	};
	if (typeof o.result === 'string') record.result = o.result;
	if (
		typeof o.failureCode === 'string' &&
		VALID_FAILURE_CODES.has(o.failureCode as TaskFailureCode)
	) {
		record.failureCode = o.failureCode as TaskFailureCode;
	}
	if (typeof o.startedAt === 'string') record.startedAt = o.startedAt;
	if (typeof o.finishedAt === 'string') record.finishedAt = o.finishedAt;
	if (typeof o.claimedAt === 'string') record.claimedAt = o.claimedAt;
	if (typeof o.reportedAt === 'string') record.reportedAt = o.reportedAt;
	return record;
}

function parseTasksFile(text: string): TasksFile | 'corrupt' {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return 'corrupt';
	}
	if (!parsed || typeof parsed !== 'object') return 'corrupt';
	const version = (parsed as { version?: unknown }).version;
	const tasksRaw = (parsed as { tasks?: unknown }).tasks;
	if (version !== 1 || !Array.isArray(tasksRaw)) return 'corrupt';

	const tasks: TaskRecord[] = [];
	for (const row of tasksRaw) {
		const t = normalizeTaskRecord(row);
		if (t) tasks.push(t);
	}
	// File had rows but none valid → corrupt (never treat as empty seedable store).
	if (tasksRaw.length > 0 && tasks.length === 0) return 'corrupt';
	return { version: 1, tasks };
}

export type ReadTasksResult =
	{ ok: true; file: TasksFile } | { ok: false; code: 'corrupt' | 'invalid_binding' | 'io_error' };

/** Fail-closed on a corrupt read exactly like `loadBindings()` does — never overwrite the
 * corrupt file. A missing file is not a failure: it means "no tasks yet". */
export async function readTasks(bindingId: string): Promise<ReadTasksResult> {
	if (!SAFE_BINDING_ID_RE.test(bindingId)) return { ok: false, code: 'invalid_binding' };

	const filePath = taskFilePath(bindingId);
	let text: string;
	try {
		text = await readFile(filePath, 'utf8');
	} catch (err) {
		const code =
			err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
		if (code === 'ENOENT') return { ok: true, file: { version: 1, tasks: [] } };
		console.error(`tasks read failed for binding ${bindingId}`);
		return { ok: false, code: 'io_error' };
	}

	const parsed = parseTasksFile(text);
	if (parsed === 'corrupt') return { ok: false, code: 'corrupt' };
	return { ok: true, file: parsed };
}

export type WriteTasksResult = { ok: true } | { ok: false; code: 'tasks_write_failed' };

/** Never throws — on failure, unlinks the temp file, logs a code/id only (no secrets, no
 * task text), and returns the failure. Mirrors `writeBindingsAtomic`'s discipline with two
 * differences: directory mode 0700 (rather than default), and a temp filename that
 * includes both the binding id AND a random component (not just pid+timestamp), since this
 * is one-file-per-binding and two bindings could theoretically be written by the same
 * process in the same millisecond. */
export async function writeTasksAtomic(
	bindingId: string,
	file: TasksFile
): Promise<WriteTasksResult> {
	if (!SAFE_BINDING_ID_RE.test(bindingId)) return { ok: false, code: 'tasks_write_failed' };

	const dir = tasksDir();
	const filePath = taskFilePath(bindingId);
	const tmpPath = path.join(
		dir,
		`.${bindingId}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`
	);

	try {
		await mkdir(dir, { recursive: true, mode: 0o700 });
		try {
			await chmod(dir, 0o700);
		} catch {
			/* not owner, non-fatal */
		}

		const payload = JSON.stringify({ version: 1, tasks: file.tasks }, null, 2) + '\n';
		const handle = await open(tmpPath, 'w', 0o600);
		try {
			await handle.writeFile(payload, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(tmpPath, filePath);
		return { ok: true };
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			/* ignore */
		}
		const message = err instanceof Error ? err.message : 'write failed';
		console.error(`tasks write failed for binding ${bindingId}: ${message}`);
		return { ok: false, code: 'tasks_write_failed' };
	}
}

function applyRetention(file: TasksFile): TasksFile {
	const now = Date.now();
	const tasks = file.tasks.filter((t) => {
		// Never drop queued/running/reporting regardless of age — reconcileStale handles
		// stuck ones via its own staleness thresholds, not this age-based prune.
		if (t.status === 'queued' || t.status === 'running' || t.status === 'reporting') return true;
		const age = now - Date.parse(t.updatedAt);
		if (t.status === 'reported') return age < TASK_RETENTION_REPORTED_MS;
		// done/failed but never reported — terminal-but-never-spoken results.
		if (t.status === 'done' || t.status === 'failed') return age < TASK_RETENTION_UNREPORTED_MS;
		return true;
	});
	return { version: 1, tasks };
}

type MutateFn<T> = (file: TasksFile) => { file: TasksFile; result: T; events: TaskBusEvent[] };
export type MutateTasksResult<T> = { ok: true; result: T } | { ok: false; code: string };

/** Per-binding promise-chain mutex serializing all writes to one binding's file — two
 * dispatches racing must not lose an update. */
const chains = new Map<string, Promise<unknown>>();

/**
 * Sequence: readTasks -> fn(file) -> apply prune/cap -> writeTasksAtomic -> only if the
 * write succeeds, publish each event in `events`, in order.
 *
 * This ordering is load-bearing: a failed write must publish nothing, so a subscriber can
 * never observe a bus event for a state change that didn't actually persist. See
 * store.server.test.ts for the regression test asserting this.
 */
export function mutateTasks<T>(bindingId: string, fn: MutateFn<T>): Promise<MutateTasksResult<T>> {
	const prior = chains.get(bindingId) ?? Promise.resolve();
	const next: Promise<MutateTasksResult<T>> = prior
		.catch(() => {
			/* a prior failed mutation must not poison the chain for subsequent callers */
		})
		.then(async (): Promise<MutateTasksResult<T>> => {
			const read = await readTasks(bindingId);
			if (!read.ok) return { ok: false, code: read.code };

			const { file, result, events } = fn(read.file);
			const pruned = applyRetention(file);

			const written = await writeTasksAtomic(bindingId, pruned);
			if (!written.ok) return { ok: false, code: written.code };

			// Write succeeded — NOW publish, and only now.
			for (const ev of events) publish(bindingId, ev);
			return { ok: true, result };
		});
	chains.set(bindingId, next);
	return next;
}

/**
 * Shared CAS claim logic — used by BOTH the /api/tasks/dispatch inline-claim path and
 * /api/tasks/ack's `claim` mode, so there is exactly one implementation of the
 * done|failed -> reporting transition. For each id where status is 'done' or 'failed',
 * transitions to 'reporting'. An id already claimed by another tab (status already
 * 'reporting', or any other status) is silently skipped, not an error — that silent skip
 * IS the CAS: first-ack-wins.
 *
 * Deliberately publishes no bus event: 'reporting' has no corresponding TaskBusEvent
 * variant, by design — entering 'reporting' is only ever meaningful to the one tab that
 * claimed it (which learns the outcome from this function's own return value, not the
 * bus). Every other status this store uses (queued/running/done/failed/reported) IS
 * broadcast, because it's part of what a fresh stream snapshot reflects; 'reporting' is a
 * single-tab-visible transient by construction.
 */
export async function claimTasks(
	bindingId: string,
	ids: string[]
): Promise<{ ok: true; claimed: TaskRecord[] } | { ok: false; code: string }> {
	const result = await mutateTasks<TaskRecord[]>(bindingId, (file) => {
		const claimed: TaskRecord[] = [];
		const now = new Date().toISOString();
		const tasks = file.tasks.map((t) => {
			if (ids.includes(t.id) && (t.status === 'done' || t.status === 'failed')) {
				const updated: TaskRecord = { ...t, status: 'reporting', claimedAt: now, updatedAt: now };
				claimed.push(updated);
				return updated;
			}
			return t;
		});
		return { file: { version: 1, tasks }, result: claimed, events: [] };
	});
	if (!result.ok) return { ok: false, code: result.code };
	return { ok: true, claimed: result.result };
}

function restoredEvent(record: TaskRecord): TaskBusEvent {
	return record.outcome === 'done'
		? { type: 'task.done', task: toPublicTask(record) }
		: { type: 'task.failed', task: toPublicTask(record) };
}

/**
 * One `mutateTasks` pass reconciling stuck records. Called at the top of every `readTasks`
 * consumer that needs fresh state — the stream route calls it on every connect; routes
 * that just need a quick read don't need to reconcile every time.
 *
 * - `running` older than RUN_STALE_MS -> if runAttempts < MAX_RUN_ATTEMPTS: back to
 *   queued, runAttempts += 1. Else: failed, failureCode 'unavailable'.
 * - `reporting` older than REPORT_CLAIM_TTL_MS -> ambiguous spoken attempt: attempts += 1.
 *   If attempts < MAX_REPORT_ATTEMPTS: restore status = outcome (re-reportable). Else:
 *   status = 'reported', drop result, console.warn with the task id (accepted bounded
 *   loss, not an error).
 * - Applies the retention sweep too (via mutateTasks's own post-fn prune/cap step).
 */
export async function reconcileStale(
	bindingId: string
): Promise<{ ok: true } | { ok: false; code: string }> {
	const result = await mutateTasks<void>(bindingId, (file) => {
		const now = Date.now();
		const nowIso = new Date(now).toISOString();
		const events: TaskBusEvent[] = [];

		const tasks = file.tasks.map((t) => {
			if (t.status === 'running') {
				const startedAt = Date.parse(t.startedAt ?? t.updatedAt);
				if (now - startedAt > RUN_STALE_MS) {
					if (t.runAttempts < MAX_RUN_ATTEMPTS) {
						const updated: TaskRecord = {
							...t,
							status: 'queued',
							runAttempts: t.runAttempts + 1,
							updatedAt: nowIso
						};
						events.push({ type: 'task.queued', task: toPublicTask(updated) });
						return updated;
					}
					const updated: TaskRecord = {
						...t,
						status: 'failed',
						outcome: 'failed',
						failureCode: 'unavailable',
						finishedAt: nowIso,
						updatedAt: nowIso
					};
					events.push({ type: 'task.failed', task: toPublicTask(updated) });
					return updated;
				}
				return t;
			}

			if (t.status === 'reporting') {
				const claimedAt = Date.parse(t.claimedAt ?? t.updatedAt);
				if (now - claimedAt > REPORT_CLAIM_TTL_MS) {
					const attempts = t.attempts + 1;
					if (attempts < MAX_REPORT_ATTEMPTS) {
						const restoredStatus = t.outcome ?? 'failed';
						const updated: TaskRecord = {
							...t,
							status: restoredStatus,
							attempts,
							updatedAt: nowIso
						};
						events.push(restoredEvent(updated));
						return updated;
					}
					console.warn(
						`task ${t.id}: exhausted report attempts on stale reclaim, marking reported`
					);
					const updated: TaskRecord = {
						...t,
						status: 'reported',
						attempts,
						reportedAt: nowIso,
						updatedAt: nowIso
					};
					delete updated.result;
					events.push({ type: 'task.reported', id: t.id });
					return updated;
				}
				return t;
			}

			return t;
		});

		return { file: { version: 1, tasks }, result: undefined, events };
	});
	if (!result.ok) return { ok: false, code: result.code };
	return { ok: true };
}
