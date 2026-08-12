import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTasks, writeTasksAtomic } from '$lib/server/tasks/store.server';
import type { TaskRecord } from '$lib/server/tasks/types';
import { POST } from './+server';

/**
 * Route-level test for POST /api/tasks/clear, modeled on the harness pattern established by
 * dispatch.test.ts — construct a fake RequestEvent, drive the real exported POST handler.
 *
 * Regression coverage for the QC finding: clear_task_queue's tool description promises
 * "Does not cancel work still in progress" — the route used to contradict that by cancelling
 * 'running' tasks (status:'failed', failureCode:'cancelled', aborting the live fetch). This
 * is dismiss-only: only queued/done/failed/reporting records get retired to 'reported';
 * 'running' records must come out completely untouched.
 */

const ORIGIN = 'http://localhost:5173';
const VOICE_KEY = 'test-voice-key';

function uniqueIp(): string {
	return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(
		Math.random() * 255
	)}`;
}

function makeEvent(opts: { origin?: string | null; body?: unknown; ip?: string }): RequestEvent {
	const origin = opts.origin === undefined ? ORIGIN : opts.origin;
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (origin) headers.set('Origin', origin);

	const request = new Request(`${ORIGIN}/api/tasks/clear`, {
		method: 'POST',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}'
	});

	return {
		request,
		url: new URL(`${ORIGIN}/api/tasks/clear`),
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		getClientAddress: () => opts.ip ?? uniqueIp(),
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: '/api/tasks/clear' },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

async function callAndGetStatus(event: RequestEvent): Promise<number> {
	try {
		const res = await POST(event);
		return res.status;
	} catch (err) {
		if (err instanceof Response) return err.status;
		if (err && typeof err === 'object' && 'status' in err) {
			return (err as { status: number }).status;
		}
		throw err;
	}
}

describe('POST /api/tasks/clear', () => {
	let dir: string;
	const bindingId = 'env';

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'hv-tasks-clear-test-'));
		process.env.TASKS_DIR = dir;
		process.env.VOICE_URL_KEY = VOICE_KEY;
		delete process.env.MULTI_USER;
	});

	afterEach(async () => {
		delete process.env.TASKS_DIR;
		delete process.env.VOICE_URL_KEY;
		await rm(dir, { recursive: true, force: true });
	});

	it('leaves a running task completely untouched and clears queued/done/failed/reporting', async () => {
		const now = new Date().toISOString();
		const running: TaskRecord = {
			id: randomUUID(),
			title: 'running-task',
			request: 'do the long thing',
			status: 'running',
			outcome: null,
			runAttempts: 1,
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			startedAt: now
		};
		const queued: TaskRecord = {
			id: randomUUID(),
			title: 'queued-task',
			request: 'do the next thing',
			status: 'queued',
			outcome: null,
			runAttempts: 0,
			attempts: 0,
			createdAt: now,
			updatedAt: now
		};
		const done: TaskRecord = {
			id: randomUUID(),
			title: 'done-task',
			request: 'already done',
			status: 'done',
			outcome: 'done',
			result: 'the result',
			runAttempts: 1,
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			finishedAt: now
		};
		await writeTasksAtomic(bindingId, { version: 1, tasks: [running, queued, done] });

		const res = await POST(makeEvent({ body: { k: VOICE_KEY } }));
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean; count?: number };
		expect(json.ok).toBe(true);
		// Only queued + done cleared — running is NOT cancelled, NOT counted.
		expect(json.count).toBe(2);

		const after = await readTasks(bindingId);
		if (!after.ok) throw new Error('readTasks failed');
		const byId = new Map(after.file.tasks.map((t) => [t.id, t]));

		const runningAfter = byId.get(running.id);
		expect(runningAfter).toEqual(running); // byte-for-byte untouched

		const queuedAfter = byId.get(queued.id);
		expect(queuedAfter?.status).toBe('reported');
		expect(queuedAfter?.result).toBeUndefined();

		const doneAfter = byId.get(done.id);
		expect(doneAfter?.status).toBe('reported');
		expect(doneAfter?.result).toBeUndefined();
	});

	it('401s a completely unauthenticated request', async () => {
		const status = await callAndGetStatus(makeEvent({ body: {} }));
		expect(status).toBe(401);
	});

	it('403s a cross-origin request', async () => {
		const status = await callAndGetStatus(
			makeEvent({ origin: 'https://evil.example', body: { k: VOICE_KEY } })
		);
		expect(status).toBe(403);
	});
});
