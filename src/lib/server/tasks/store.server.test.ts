import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Wrap (not replace) open/rename so every call still does the real fs operation by
// default — individual tests can override with mockRejectedValueOnce/mock.calls
// inspection without disturbing every other test in this file.
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

// store.server.ts's only dependency on the bus is `publish` — mocking the whole module
// lets every test in this file assert on it directly, most importantly the "failed write
// never publishes" invariant test below.
vi.mock('./bus.server', () => ({ publish: vi.fn() }));

import { open, rename } from 'node:fs/promises';
import { publish } from './bus.server';
import {
	MAX_REPORT_ATTEMPTS,
	MAX_RUN_ATTEMPTS,
	REPORT_CLAIM_TTL_MS,
	RUN_STALE_MS,
	TASK_RETENTION_REPORTED_MS,
	TASK_RETENTION_UNREPORTED_MS
} from './constants';
import {
	claimTasks,
	mutateTasks,
	reconcileStale,
	readTasks,
	SAFE_BINDING_ID_RE,
	writeTasksAtomic
} from './store.server';
import { toPublicTask, type TaskRecord, type TasksFile } from './types';

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'hv-tasks-store-test-'));
	process.env.TASKS_DIR = dir;
	vi.mocked(publish).mockClear();
	vi.mocked(open).mockClear();
	vi.mocked(rename).mockClear();
});

afterEach(async () => {
	delete process.env.TASKS_DIR;
	await rm(dir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		title: 'Test task',
		request: 'do the thing',
		status: 'queued',
		outcome: null,
		runAttempts: 0,
		attempts: 0,
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

function daysAgo(n: number): string {
	return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('SAFE_BINDING_ID_RE', () => {
	it('accepts "env"', () => {
		expect(SAFE_BINDING_ID_RE.test('env')).toBe(true);
	});
	it('accepts a UUID', () => {
		expect(SAFE_BINDING_ID_RE.test(randomUUID())).toBe(true);
	});
	it('rejects path traversal "../"', () => {
		expect(SAFE_BINDING_ID_RE.test('../evil')).toBe(false);
	});
	it('rejects an embedded path separator "a/b"', () => {
		expect(SAFE_BINDING_ID_RE.test('a/b')).toBe(false);
	});
	it('rejects an empty string', () => {
		expect(SAFE_BINDING_ID_RE.test('')).toBe(false);
	});
	it('rejects a 65-char id (over the 64 cap)', () => {
		expect(SAFE_BINDING_ID_RE.test('a'.repeat(65))).toBe(false);
	});
	it('accepts a 64-char id (at the cap)', () => {
		expect(SAFE_BINDING_ID_RE.test('a'.repeat(64))).toBe(true);
	});
});

describe('readTasks — invalid binding id', () => {
	it('rejects outright, before any path.join-based fs access', async () => {
		const result = await readTasks('../evil');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('invalid_binding');
	});

	it('a missing file is not a failure — returns an empty TasksFile', async () => {
		const result = await readTasks(randomUUID());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.file).toEqual({ version: 1, tasks: [] });
	});
});

describe('writeTasksAtomic — directory discipline', () => {
	it('creates/tightens the tasks dir to mode 0700 even if it pre-existed with looser perms', async () => {
		await chmod(dir, 0o755);
		const before = await stat(dir);
		expect(before.mode & 0o777).toBe(0o755);

		const result = await writeTasksAtomic(randomUUID(), { version: 1, tasks: [] });
		expect(result.ok).toBe(true);

		const after = await stat(dir);
		expect(after.mode & 0o777).toBe(0o700);
	});

	it('uses distinct temp file names for two bindings written in the same tick', async () => {
		const bindingA = randomUUID();
		const bindingB = randomUUID();

		const [resA, resB] = await Promise.all([
			writeTasksAtomic(bindingA, { version: 1, tasks: [] }),
			writeTasksAtomic(bindingB, { version: 1, tasks: [] })
		]);
		expect(resA.ok).toBe(true);
		expect(resB.ok).toBe(true);

		const openedPaths = vi.mocked(open).mock.calls.map((c) => String(c[0]));
		expect(openedPaths.length).toBe(2);
		expect(openedPaths[0]).not.toBe(openedPaths[1]);
		expect(openedPaths.some((p) => p.includes(`.${bindingA}.`))).toBe(true);
		expect(openedPaths.some((p) => p.includes(`.${bindingB}.`))).toBe(true);
	});

	it('rejects an unsafe binding id before any path.join call, never writing anything', async () => {
		const result = await writeTasksAtomic('../evil', { version: 1, tasks: [] });
		expect(result.ok).toBe(false);
		expect(vi.mocked(open)).not.toHaveBeenCalled();
	});
});

describe('readTasks / mutateTasks — corrupt file handling', () => {
	it('a corrupt file is never overwritten: readTasks fails closed and mutateTasks fails without writing', async () => {
		const bindingId = randomUUID();
		const filePath = path.join(dir, `${bindingId}.json`);
		await writeFile(filePath, '{not valid json', 'utf8');

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.code).toBe('corrupt');

		const mutated = await mutateTasks(bindingId, (file) => ({
			file: { version: 1, tasks: [...file.tasks, makeTask()] },
			result: undefined,
			events: []
		}));
		expect(mutated.ok).toBe(false);

		const rawAfter = await readFile(filePath, 'utf8');
		expect(rawAfter).toBe('{not valid json');
		expect(publish).not.toHaveBeenCalled();
	});
});

describe('mutateTasks — write-then-publish ordering invariant', () => {
	it('a failed write never triggers a bus publish, and does not poison the per-binding chain', async () => {
		const bindingId = randomUUID();
		vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));

		const task = makeTask();
		const result = await mutateTasks(bindingId, (file) => ({
			file: { version: 1, tasks: [...file.tasks, task] },
			result: undefined,
			events: [{ type: 'task.queued', task: toPublicTask(task) }]
		}));

		expect(result.ok).toBe(false);
		expect(publish).not.toHaveBeenCalled();

		// The failed write must not corrupt the store OR leave the on-disk file changed.
		const readAfterFailure = await readTasks(bindingId);
		expect(readAfterFailure.ok).toBe(true);
		if (readAfterFailure.ok) expect(readAfterFailure.file.tasks).toEqual([]);

		// A subsequent write (rename no longer forced to fail) proves the mutex chain
		// wasn't left in a broken state by the earlier rejection.
		const second = await mutateTasks(bindingId, (file) => ({
			file: { version: 1, tasks: [...file.tasks, makeTask()] },
			result: undefined,
			events: []
		}));
		expect(second.ok).toBe(true);
	});
});

describe('mutateTasks — concurrency', () => {
	it('50 concurrent calls on one binding produce zero lost updates', async () => {
		const bindingId = randomUUID();
		const calls = Array.from({ length: 50 }, (_, i) =>
			mutateTasks(bindingId, (file) => ({
				file: { version: 1, tasks: [...file.tasks, makeTask({ title: `task-${i}` })] },
				result: undefined,
				events: []
			}))
		);
		const results = await Promise.all(calls);
		expect(results.every((r) => r.ok)).toBe(true);

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(true);
		if (read.ok) expect(read.file.tasks.length).toBe(50);
	});
});

describe('prune/cap — never evicts live statuses, applies two-tier retention', () => {
	it('never evicts queued/running/reporting regardless of age', async () => {
		const bindingId = randomUUID();
		const old = daysAgo(9999);
		const seed: TasksFile = {
			version: 1,
			tasks: [
				makeTask({ id: 'q1', status: 'queued', updatedAt: old }),
				makeTask({ id: 'r1', status: 'running', updatedAt: old }),
				makeTask({ id: 'p1', status: 'reporting', outcome: 'done', updatedAt: old })
			]
		};
		await writeTasksAtomic(bindingId, seed);

		// Trigger the prune/cap path via a no-op mutation.
		await mutateTasks(bindingId, (file) => ({ file, result: undefined, events: [] }));

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(true);
		if (read.ok) {
			expect(read.file.tasks.map((t) => t.id).sort()).toEqual(['p1', 'q1', 'r1']);
		}
	});

	it('drops done/failed (never reported) older than TASK_RETENTION_UNREPORTED_MS (30d), keeps newer ones', async () => {
		const bindingId = randomUUID();
		const justOver = new Date(Date.now() - TASK_RETENTION_UNREPORTED_MS - 1000).toISOString();
		const justUnder = new Date(Date.now() - TASK_RETENTION_UNREPORTED_MS + 60_000).toISOString();
		const seed: TasksFile = {
			version: 1,
			tasks: [
				makeTask({ id: 'old-done', status: 'done', outcome: 'done', updatedAt: justOver }),
				makeTask({ id: 'new-done', status: 'done', outcome: 'done', updatedAt: justUnder }),
				makeTask({ id: 'old-failed', status: 'failed', outcome: 'failed', updatedAt: justOver })
			]
		};
		await writeTasksAtomic(bindingId, seed);
		await mutateTasks(bindingId, (file) => ({ file, result: undefined, events: [] }));

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(true);
		if (read.ok) expect(read.file.tasks.map((t) => t.id)).toEqual(['new-done']);
	});

	it('drops reported older than TASK_RETENTION_REPORTED_MS (7d), keeps newer ones', async () => {
		const bindingId = randomUUID();
		const justOver = new Date(Date.now() - TASK_RETENTION_REPORTED_MS - 1000).toISOString();
		const justUnder = new Date(Date.now() - TASK_RETENTION_REPORTED_MS + 60_000).toISOString();
		const seed: TasksFile = {
			version: 1,
			tasks: [
				makeTask({ id: 'old-reported', status: 'reported', outcome: 'done', updatedAt: justOver }),
				makeTask({ id: 'new-reported', status: 'reported', outcome: 'done', updatedAt: justUnder })
			]
		};
		await writeTasksAtomic(bindingId, seed);
		await mutateTasks(bindingId, (file) => ({ file, result: undefined, events: [] }));

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(true);
		if (read.ok) expect(read.file.tasks.map((t) => t.id)).toEqual(['new-reported']);
	});
});

describe('reconcileStale', () => {
	it('flips a stale running task back to queued when under MAX_RUN_ATTEMPTS', async () => {
		const bindingId = randomUUID();
		const staleStart = new Date(Date.now() - RUN_STALE_MS - 5000).toISOString();
		const task = makeTask({
			id: 't1',
			status: 'running',
			startedAt: staleStart,
			updatedAt: staleStart,
			runAttempts: 0
		});
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		const result = await reconcileStale(bindingId);
		expect(result.ok).toBe(true);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === 't1');
			expect(updated?.status).toBe('queued');
			expect(updated?.runAttempts).toBe(1);
		}
	});

	it('flips a stale running task to failed/unavailable once runAttempts is at MAX_RUN_ATTEMPTS', async () => {
		const bindingId = randomUUID();
		const staleStart = new Date(Date.now() - RUN_STALE_MS - 5000).toISOString();
		const task = makeTask({
			id: 't1',
			status: 'running',
			startedAt: staleStart,
			updatedAt: staleStart,
			runAttempts: MAX_RUN_ATTEMPTS
		});
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await reconcileStale(bindingId);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === 't1');
			expect(updated?.status).toBe('failed');
			expect(updated?.outcome).toBe('failed');
			expect(updated?.failureCode).toBe('unavailable');
		}
	});

	it('restores a stale reporting task to its outcome status when under MAX_REPORT_ATTEMPTS', async () => {
		const bindingId = randomUUID();
		const staleClaim = new Date(Date.now() - REPORT_CLAIM_TTL_MS - 5000).toISOString();
		const task = makeTask({
			id: 't1',
			status: 'reporting',
			outcome: 'done',
			result: 'the answer',
			claimedAt: staleClaim,
			updatedAt: staleClaim,
			attempts: 0
		});
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await reconcileStale(bindingId);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === 't1');
			expect(updated?.status).toBe('done');
			expect(updated?.attempts).toBe(1);
			expect(updated?.result).toBe('the answer');
		}
	});

	it('marks a stale reporting task reported (dropping result) once MAX_REPORT_ATTEMPTS is exhausted', async () => {
		const bindingId = randomUUID();
		const staleClaim = new Date(Date.now() - REPORT_CLAIM_TTL_MS - 5000).toISOString();
		const task = makeTask({
			id: 't1',
			status: 'reporting',
			outcome: 'failed',
			failureCode: 'timeout',
			claimedAt: staleClaim,
			updatedAt: staleClaim,
			attempts: MAX_REPORT_ATTEMPTS - 1
		});
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await reconcileStale(bindingId);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === 't1');
			expect(updated?.status).toBe('reported');
			expect(updated?.result).toBeUndefined();
			expect(updated?.attempts).toBe(MAX_REPORT_ATTEMPTS);
		}
	});

	it('does not touch a running/reporting task that is not yet stale', async () => {
		const bindingId = randomUUID();
		const recent = new Date().toISOString();
		const task = makeTask({ id: 't1', status: 'running', startedAt: recent, updatedAt: recent });
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await reconcileStale(bindingId);

		const read = await readTasks(bindingId);
		if (read.ok) expect(read.file.tasks.find((t) => t.id === 't1')?.status).toBe('running');
	});
});

describe('hard invariant — a written task file never contains a credential substring', () => {
	it('the on-disk JSON never contains bindingId or any Binding credential field name', async () => {
		const bindingId = randomUUID();
		// A fully-populated record exercising every optional field, so the assertion below
		// covers the whole shape, not just the required fields.
		const task = makeTask({
			result: 'some result text',
			failureCode: 'timeout',
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			claimedAt: new Date().toISOString(),
			reportedAt: new Date().toISOString()
		});
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		const raw = await readFile(path.join(dir, `${bindingId}.json`), 'utf8');

		// TaskRecord deliberately has no bindingId field — the binding is identified purely
		// by which file it's in — and never carries any Binding credential. Assert both the
		// field names and a couple of realistic-looking secret shapes are absent.
		for (const forbidden of ['bindingId', 'hermesApiKey', 'hermesSessionKey', 'voiceKey', '"k":']) {
			expect(raw).not.toContain(forbidden);
		}
	});
});

describe('claimTasks — shared CAS logic', () => {
	it('claims done/failed tasks (-> reporting) and silently skips ids already claimed or unknown', async () => {
		const bindingId = randomUUID();
		const t1 = makeTask({ id: 't1', status: 'done', outcome: 'done', result: 'ok' });
		const t2 = makeTask({ id: 't2', status: 'reporting', outcome: 'done' }); // already claimed
		await writeTasksAtomic(bindingId, { version: 1, tasks: [t1, t2] });

		const result = await claimTasks(bindingId, ['t1', 't2', 'nonexistent']);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.claimed.map((t) => t.id)).toEqual(['t1']);
			expect(result.claimed[0].status).toBe('reporting');
		}

		// Claiming does not publish a bus event by design — 'reporting' has no TaskBusEvent variant.
		expect(publish).not.toHaveBeenCalled();
	});
});
