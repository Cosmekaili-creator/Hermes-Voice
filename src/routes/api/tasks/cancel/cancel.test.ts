import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abortByTask } from '$lib/server/tasks/runner.server';
import { readTasks, writeTasksAtomic } from '$lib/server/tasks/store.server';
import type { TaskRecord } from '$lib/server/tasks/types';
import { POST } from './+server';

const ORIGIN = 'http://localhost:5173';
const VOICE_KEY = 'cancel-test-voice-key-0123456789abcdef';

let n = 0;
function makeEvent(body: unknown): RequestEvent {
	n += 1;
	return {
		request: new Request(`${ORIGIN}/api/tasks/cancel`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
			body: JSON.stringify(body)
		}),
		url: new URL(`${ORIGIN}/api/tasks/cancel`),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} },
		getClientAddress: () => `198.51.100.${(n % 250) + 1}`,
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/tasks/cancel' }
	} as unknown as RequestEvent;
}

function task(status: TaskRecord['status']): TaskRecord {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		title: `${status}-task`,
		request: 'something',
		status,
		outcome: null,
		runAttempts: status === 'running' ? 1 : 0,
		attempts: 0,
		createdAt: now,
		updatedAt: now
	};
}

describe('POST /api/tasks/cancel', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'hv-tasks-cancel-'));
		process.env.TASKS_DIR = dir;
		process.env.VOICE_URL_KEY = VOICE_KEY;
		delete process.env.MULTI_USER;
	});

	afterEach(async () => {
		delete process.env.TASKS_DIR;
		delete process.env.VOICE_URL_KEY;
		await rm(dir, { recursive: true, force: true });
	});

	it('retires a running task silently and aborts its in-flight run', async () => {
		const running = task('running');
		await writeTasksAtomic('env', { version: 1, tasks: [running] });
		const ac = new AbortController();
		abortByTask.set(running.id, ac);

		const res = await POST(makeEvent({ k: VOICE_KEY, id: running.id }));
		expect(res.status).toBe(200);
		expect(ac.signal.aborted).toBe(true);
		const read = await readTasks('env');
		const rec = read.ok ? read.file.tasks[0] : undefined;
		expect(rec?.status).toBe('reported');
		expect(rec?.failureCode).toBe('cancelled');
		abortByTask.delete(running.id);
	});

	it('cancels a queued task without touching others', async () => {
		const queued = task('queued');
		const done = task('done');
		await writeTasksAtomic('env', { version: 1, tasks: [queued, done] });
		const res = await POST(makeEvent({ k: VOICE_KEY, id: queued.id }));
		expect(res.status).toBe(200);
		const read = await readTasks('env');
		const tasks = read.ok ? read.file.tasks : [];
		expect(tasks.find((t) => t.id === queued.id)?.status).toBe('reported');
		expect(tasks.find((t) => t.id === done.id)?.status).toBe('done');
	});

	it('404s for an unknown id and never aborts a run it does not own', async () => {
		await writeTasksAtomic('env', { version: 1, tasks: [task('queued')] });
		const foreignId = randomUUID();
		const ac = new AbortController();
		abortByTask.set(foreignId, ac);
		const res = await POST(makeEvent({ k: VOICE_KEY, id: foreignId }));
		expect(res.status).toBe(404);
		expect(ac.signal.aborted).toBe(false);
		abortByTask.delete(foreignId);
	});

	it('refuses unauthenticated callers', async () => {
		await expect(POST(makeEvent({ id: randomUUID() }))).rejects.toMatchObject({ status: 401 });
	});

	it('also aborts a queued task the runner already picked up (cancel/runner race)', async () => {
		const queued = task('queued');
		await writeTasksAtomic('env', { version: 1, tasks: [queued] });
		const ac = new AbortController();
		abortByTask.set(queued.id, ac);
		const res = await POST(makeEvent({ k: VOICE_KEY, id: queued.id }));
		expect(res.status).toBe(200);
		expect(ac.signal.aborted).toBe(true);
		abortByTask.delete(queued.id);
	});
});
