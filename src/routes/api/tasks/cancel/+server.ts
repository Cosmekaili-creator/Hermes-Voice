import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { abortByTask } from '$lib/server/tasks/runner.server';
import { mutateTasks } from '$lib/server/tasks/store.server';
import type { TaskBusEvent, TaskRecord } from '$lib/server/tasks/types';

type CancelResult = { found: boolean; wasRunning: boolean };

/**
 * POST { id } — the user cancels ONE queued or running task from the task orbit.
 *
 * Binding-scoped by construction: the task is looked up only inside the caller's own
 * per-binding store, so an id belonging to someone else is simply "not found" — and the
 * in-flight AbortController is only touched after that ownership check succeeded.
 *
 * A cancelled task is retired silently (status 'reported', outcome 'failed',
 * failureCode 'cancelled', `task.cleared` event): the user asked for it to stop, so it
 * must never come back as a spoken "that task failed" report. The runner's mark* helpers
 * skip 'reported' tasks, so a completion racing the abort can't resurrect it.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'tasks', RATE.tasks.limit, RATE.tasks.windowMs, binding.id);

	const id =
		body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
			? (body as { id: string }).id.trim()
			: '';
	if (!id || id.length > 64) {
		return json({ ok: false, code: 'invalid_id' }, { status: 400 });
	}

	const result = await mutateTasks<CancelResult>(binding.id, (file) => {
		const now = new Date().toISOString();
		let found = false;
		let wasRunning = false;
		const tasks = file.tasks.map((t) => {
			if (t.id !== id || (t.status !== 'queued' && t.status !== 'running')) return t;
			found = true;
			wasRunning = t.status === 'running';
			const updated: TaskRecord = {
				...t,
				status: 'reported',
				outcome: 'failed',
				failureCode: 'cancelled',
				finishedAt: now,
				reportedAt: now,
				updatedAt: now
			};
			delete updated.result;
			delete updated.cards;
			return updated;
		});
		const events: TaskBusEvent[] = found ? [{ type: 'task.cleared', ids: [id] }] : [];
		return { file: { version: 1, tasks }, result: { found, wasRunning }, events };
	});

	if (!result.ok) {
		return json({ ok: false, code: 'store_unavailable' }, { status: 503 });
	}
	if (!result.result.found) {
		return json({ ok: false, code: 'not_found' }, { status: 404 });
	}
	if (result.result.wasRunning) {
		abortByTask.get(id)?.abort();
	}
	return json({ ok: true });
};
