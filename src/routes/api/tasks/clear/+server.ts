import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { mutateTasks } from '$lib/server/tasks/store.server';
import type { TaskBusEvent, TaskRecord } from '$lib/server/tasks/types';

type ClearResult = { count: number };

/**
 * No body needed beyond auth. Dismiss-only: every completed-but-unreported record is
 * retired, in-flight work is left completely untouched.
 * - queued/done/failed/reporting -> status:'reported', reportedAt:now, drop result.
 * - running -> untouched. clear_task_queue must never cancel work still in progress
 *   (confirmed product decision) — the tool description promises this, so the route must
 *   honor it rather than the other way around.
 *
 * On write failure: {ok:false}, and nothing in the store changes — this route must not
 * report success unless the write actually succeeded, since the client only drains its own
 * local queue after seeing ok:true.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'tasks', RATE.tasks.limit, RATE.tasks.windowMs, binding.id);

	const result = await mutateTasks<ClearResult>(binding.id, (file) => {
		const now = new Date().toISOString();
		const clearedIds: string[] = [];

		const tasks = file.tasks.map((t) => {
			if (
				t.status === 'queued' ||
				t.status === 'done' ||
				t.status === 'failed' ||
				t.status === 'reporting'
			) {
				clearedIds.push(t.id);
				const updated: TaskRecord = { ...t, status: 'reported', reportedAt: now, updatedAt: now };
				delete updated.result;
				return updated;
			}
			return t;
		});

		const events: TaskBusEvent[] =
			clearedIds.length > 0 ? [{ type: 'task.cleared', ids: clearedIds }] : [];
		return { file: { version: 1, tasks }, result: { count: clearedIds.length }, events };
	});

	if (!result.ok) {
		return json({ ok: false }, { status: 503 });
	}

	return json({ ok: true, count: result.result.count });
};
