import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/bindings.server', () => ({ getBindingById: vi.fn() }));
vi.mock('$lib/server/hermes', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/hermes')>();
	return { ...actual, streamHermesChat: vi.fn() };
});

import { getBindingById } from '$lib/server/bindings.server';
import { streamHermesChat } from '$lib/server/hermes';
import { classifyRunFailure, runTask, sanitizeResult } from './runner.server';
import { readTasks, writeTasksAtomic } from './store.server';
import type { TaskRecord } from './types';

/** Builds a real SvelteKit HttpError the same way hermes.ts produces one — `error()` throws. */
function makeHttpError(status: number, message: string): unknown {
	try {
		error(status, message);
	} catch (e) {
		return e;
	}
	throw new Error('unreachable: error() did not throw');
}

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'hv-tasks-runner-test-'));
	process.env.TASKS_DIR = dir;
	vi.mocked(getBindingById).mockReset();
	vi.mocked(streamHermesChat).mockReset();
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

describe('classifyRunFailure', () => {
	it('maps HttpError 499 -> cancelled', () => {
		expect(classifyRunFailure(makeHttpError(499, 'Cancelled'))).toBe('cancelled');
	});
	it('maps HttpError 504 -> timeout', () => {
		expect(classifyRunFailure(makeHttpError(504, 'Hermes timeout'))).toBe('timeout');
	});
	it('maps HttpError 502 -> upstream', () => {
		expect(classifyRunFailure(makeHttpError(502, 'Hermes request failed'))).toBe('upstream');
	});
	it('maps HttpError 400 -> too_large', () => {
		expect(classifyRunFailure(makeHttpError(400, 'Request too large'))).toBe('too_large');
	});
	it('maps HttpError 500 -> config', () => {
		expect(classifyRunFailure(makeHttpError(500, 'Hermes bridge unavailable'))).toBe('config');
	});
	it('maps an unrecognized HttpError status -> unavailable', () => {
		expect(classifyRunFailure(makeHttpError(418, 'teapot'))).toBe('unavailable');
	});

	it('a bare, non-HttpError Error("boom") classifies as unavailable, not uncaught', () => {
		expect(classifyRunFailure(new Error('boom'))).toBe('unavailable');
	});
	it('a bare TypeError classifies as unavailable', () => {
		expect(classifyRunFailure(new TypeError('malformed header'))).toBe('unavailable');
	});
	it('a non-Error thrown value classifies as unavailable', () => {
		expect(classifyRunFailure('plain string throw')).toBe('unavailable');
		expect(classifyRunFailure(undefined)).toBe('unavailable');
	});
});

describe('sanitizeResult', () => {
	it('strips control characters', () => {
		expect(sanitizeResult('hello\x00world')).toBe('hello world');
	});
	it('collapses whitespace and trims', () => {
		expect(sanitizeResult('  hello   world  ')).toBe('hello world');
	});
	it('caps length at MAX_TASK_RESULT_CHARS', () => {
		const long = 'a'.repeat(5000);
		expect(sanitizeResult(long).length).toBeLessThanOrEqual(4000);
	});
});

describe('runTask — failure classification without throwing', () => {
	it('binding_missing: getBindingById returns null', async () => {
		vi.mocked(getBindingById).mockResolvedValue(null);
		const bindingId = randomUUID();
		const task = makeTask();
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await expect(runTask(bindingId, task.id)).resolves.toBeUndefined();

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === task.id);
			expect(updated?.status).toBe('failed');
			expect(updated?.failureCode).toBe('binding_missing');
		}
	});

	it('binding_disabled: getBindingById returns a disabled binding', async () => {
		vi.mocked(getBindingById).mockResolvedValue({
			id: 'b1',
			label: 'X',
			role: 'owner',
			voiceKey: 'k',
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: 'key',
			hermesSessionKey: 'agent:main:voice',
			enabled: false,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const bindingId = randomUUID();
		const task = makeTask();
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await runTask(bindingId, task.id);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === task.id);
			expect(updated?.status).toBe('failed');
			expect(updated?.failureCode).toBe('binding_disabled');
		}
	});

	it('config: getBindingById returns an enabled binding with no hermesApiKey', async () => {
		vi.mocked(getBindingById).mockResolvedValue({
			id: 'b1',
			label: 'X',
			role: 'owner',
			voiceKey: 'k',
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: '',
			hermesSessionKey: 'agent:main:voice',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const bindingId = randomUUID();
		const task = makeTask();
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await runTask(bindingId, task.id);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === task.id);
			expect(updated?.status).toBe('failed');
			expect(updated?.failureCode).toBe('config');
		}
	});
});

describe('runTask — in-flight counter never leaks after an unexpected throw', () => {
	it('8 sequential unexpected (non-HttpError) throws never leave MAX_RUNNING_PER_BINDING permanently exhausted', async () => {
		// getBindingById throwing a bare Error is exactly the "malformed session-id header"
		// style unexpected failure classifyRunFailure's catch-all exists for — NOT one of
		// streamHermesChat's classified HttpError paths. If endRun() were ever skipped,
		// MAX_RUNNING_PER_BINDING=1 means every call after the first would silently no-op
		// (beginRun() returning false) and its task would stay stuck at 'queued' forever.
		vi.mocked(getBindingById).mockRejectedValue(new Error('boom'));

		const bindingId = randomUUID();
		const tasks = Array.from({ length: 8 }, () => makeTask());
		await writeTasksAtomic(bindingId, { version: 1, tasks });

		for (const task of tasks) {
			await runTask(bindingId, task.id);
		}

		const read = await readTasks(bindingId);
		expect(read.ok).toBe(true);
		if (read.ok) {
			// If the counter had leaked after call #1, calls #2-8 would each have been a
			// silent no-op and their tasks would still be 'queued'.
			for (const t of read.file.tasks) {
				expect(t.status).toBe('failed');
				expect(t.failureCode).toBe('unavailable');
			}
			expect(read.file.tasks).toHaveLength(8);
		}
	});
});

describe('runTask — happy path', () => {
	it('runs a queued task through to done, sanitizing the result', async () => {
		vi.mocked(getBindingById).mockResolvedValue({
			id: 'b1',
			label: 'X',
			role: 'owner',
			voiceKey: 'k',
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: 'key',
			hermesSessionKey: 'agent:main:voice',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		vi.mocked(streamHermesChat).mockResolvedValue({ text: '  the   answer  ' });

		const bindingId = randomUUID();
		const task = makeTask();
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await runTask(bindingId, task.id);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === task.id);
			expect(updated?.status).toBe('done');
			expect(updated?.outcome).toBe('done');
			expect(updated?.result).toBe('the answer');
		}
	});

	it('an unexpected throw from streamHermesChat classifies as unavailable', async () => {
		vi.mocked(getBindingById).mockResolvedValue({
			id: 'b1',
			label: 'X',
			role: 'owner',
			voiceKey: 'k',
			hermesApiBase: 'http://127.0.0.1:8642',
			hermesApiKey: 'key',
			hermesSessionKey: 'agent:main:voice',
			enabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		vi.mocked(streamHermesChat).mockRejectedValue(new TypeError('malformed session id'));

		const bindingId = randomUUID();
		const task = makeTask();
		await writeTasksAtomic(bindingId, { version: 1, tasks: [task] });

		await runTask(bindingId, task.id);

		const read = await readTasks(bindingId);
		if (read.ok) {
			const updated = read.file.tasks.find((t) => t.id === task.id);
			expect(updated?.status).toBe('failed');
			expect(updated?.failureCode).toBe('unavailable');
		}
	});
});
