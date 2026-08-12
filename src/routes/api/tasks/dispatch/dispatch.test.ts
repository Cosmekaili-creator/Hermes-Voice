import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mutateTasks, writeTasksAtomic } from '$lib/server/tasks/store.server';
import { toPublicTask, type TaskBusEvent, type TaskRecord } from '$lib/server/tasks/types';
import { POST } from './+server';

/**
 * Stand-in for the real runner (which would hit a real Hermes fetch): the moment
 * scheduleBinding() is called, instantly completes any 'queued' task for that binding with a
 * canned result and publishes task.done — lets tests exercise raceForTerminal()/inline mode
 * deterministically without any network I/O.
 */
vi.mock('$lib/server/tasks/runner.server', () => ({
	scheduleBinding: (bindingId: string) => {
		void mutateTasks(bindingId, (file) => {
			const events: TaskBusEvent[] = [];
			const tasks = file.tasks.map((t) => {
				if (t.status !== 'queued') return t;
				const now = new Date().toISOString();
				const updated: TaskRecord = {
					...t,
					status: 'done',
					outcome: 'done',
					result: 'stub result',
					finishedAt: now,
					updatedAt: now
				};
				events.push({ type: 'task.done', task: toPublicTask(updated) });
				return updated;
			});
			return { file: { version: 1, tasks }, result: undefined, events };
		});
	},
	abortByTask: new Map()
}));

/**
 * Route-level test for POST /api/tasks/dispatch, modeled on the harness pattern
 * established by src/routes/api/setup/restart/restart.test.ts and
 * src/routes/api/settings/save/save.test.ts — construct a fake RequestEvent, drive the
 * real exported POST handler, real auth/rate-limit/env code paths.
 *
 * Only covers the auth/validation edges that never reach the runner (no network calls):
 * 401 unauthenticated, 400 on an empty request, and queue_full at the cap. All three
 * return before dispatch's own mutateTasks/scheduleBinding calls, so nothing here ever
 * triggers a real Hermes fetch.
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

	const request = new Request(`${ORIGIN}/api/tasks/dispatch`, {
		method: 'POST',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : '{}'
	});

	return {
		request,
		url: new URL(`${ORIGIN}/api/tasks/dispatch`),
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
		route: { id: '/api/tasks/dispatch' },
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

describe('POST /api/tasks/dispatch', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'hv-tasks-dispatch-test-'));
		process.env.TASKS_DIR = dir;
		process.env.VOICE_URL_KEY = VOICE_KEY;
		delete process.env.MULTI_USER;
		delete process.env.VOICE_ASYNC_TASKS;
	});

	afterEach(async () => {
		delete process.env.TASKS_DIR;
		delete process.env.VOICE_URL_KEY;
		delete process.env.VOICE_ASYNC_TASKS;
		await rm(dir, { recursive: true, force: true });
	});

	it('401s a completely unauthenticated request (no voice key at all)', async () => {
		const status = await callAndGetStatus(makeEvent({ body: { request: 'do something' } }));
		expect(status).toBe(401);
	});

	it('403s a cross-origin request', async () => {
		const status = await callAndGetStatus(
			makeEvent({
				origin: 'https://evil.example',
				body: { k: VOICE_KEY, request: 'do something' }
			})
		);
		expect(status).toBe(403);
	});

	it('400s on an empty/missing request field', async () => {
		const res = await POST(makeEvent({ body: { k: VOICE_KEY, title: 'A task' } }));
		expect(res.status).toBe(400);
		const json = (await res.json()) as { ok: boolean; code?: string };
		expect(json).toEqual({ ok: false, code: 'empty_request' });
	});

	it('503s feature_disabled when VOICE_ASYNC_TASKS=0', async () => {
		process.env.VOICE_ASYNC_TASKS = '0';
		const res = await POST(makeEvent({ body: { k: VOICE_KEY, request: 'do something' } }));
		expect(res.status).toBe(503);
		const json = (await res.json()) as { ok: boolean; code?: string };
		expect(json).toEqual({ ok: false, code: 'feature_disabled' });
	});

	it('returns queue_full (200, not an error status) once MAX_QUEUED_PER_BINDING is reached', async () => {
		// Single-user synthetic binding id is 'env' (bindings.server.ts::syntheticEnvBinding).
		const bindingId = 'env';
		const now = new Date().toISOString();
		const seeded: TaskRecord[] = Array.from({ length: 20 }, (_, i) => ({
			id: randomUUID(),
			title: `seed-${i}`,
			request: 'seed request',
			status: 'queued',
			outcome: null,
			runAttempts: 0,
			attempts: 0,
			createdAt: now,
			updatedAt: now
		}));
		await writeTasksAtomic(bindingId, { version: 1, tasks: seeded });

		const res = await POST(makeEvent({ body: { k: VOICE_KEY, request: 'one more' } }));
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean; code?: string };
		expect(json).toEqual({ ok: false, code: 'queue_full' });
	});

	it('inline mode (fast completion) includes the task id in the response payload', async () => {
		// Regression test for the QC finding: the inline-dispatch response previously omitted
		// `id`, so the client had no way to call /api/tasks/ack with mode:'confirm' for a task
		// it had already claimed and spoken inline — leaving it stranded in 'reporting' until
		// the server's TTL sweep restored and republished it as a second, phantom report. The
		// fake scheduleBinding() above completes the task near-instantly, so raceForTerminal()
		// wins the race within a short waitMs and the route takes the `mode: 'inline'` branch.
		const res = await POST(
			makeEvent({ body: { k: VOICE_KEY, request: 'do something quick', waitMs: 500 } })
		);
		expect(res.status).toBe(202);
		const body = (await res.json()) as {
			ok: boolean;
			mode: string;
			id?: string;
			outcome?: string;
			result?: string;
		};
		expect(body.ok).toBe(true);
		expect(body.mode).toBe('inline');
		expect(body.outcome).toBe('done');
		expect(body.result).toBe('stub result');
		expect(typeof body.id).toBe('string');
		expect(body.id).toHaveLength(36); // randomUUID
	});
});
