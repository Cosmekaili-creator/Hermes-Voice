import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { MAX_REPORT_ATTEMPTS } from '$lib/server/tasks/constants';
import { claimTasks, mutateTasks } from '$lib/server/tasks/store.server';
import { toPublicTask, type TaskBusEvent, type TaskRecord } from '$lib/server/tasks/types';

function parseIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/**
 * POST body: { mode: 'claim'|'confirm'|'release', ids: string[], spoken?: boolean }.
 * Each mode executes its CAS transition inside exactly one `mutateTasks` call per
 * invocation — looping over `ids` inside the single `fn` passed to `mutateTasks`, never
 * one `mutateTasks` call per id, since per-id calls would defeat the atomicity of the
 * batch (another writer could interleave between two ids' transitions).
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'tasks', RATE.tasks.limit, RATE.tasks.windowMs, binding.id);

	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const rawMode = b.mode;
	const ids = parseIds(b.ids);
	const spoken = b.spoken === true;

	if (rawMode !== 'claim' && rawMode !== 'confirm' && rawMode !== 'release') {
		return json({ ok: false, code: 'invalid_mode' }, { status: 400 });
	}
	const mode: 'claim' | 'confirm' | 'release' = rawMode;
	if (ids.length === 0) {
		return json({ ok: false, code: 'invalid_ids' }, { status: 400 });
	}

	if (mode === 'claim') {
		const result = await claimTasks(binding.id, ids);
		if (!result.ok) return json({ ok: false, code: result.code }, { status: 503 });
		// This is the one place `result`/`failureCode` legitimately cross the wire outside
		// the inline-dispatch path — the client is about to speak it.
		return json({ ok: true, claimed: result.claimed.map(toPublicTask) });
	}

	if (mode === 'confirm') {
		const result = await mutateTasks<number>(binding.id, (file) => {
			let count = 0;
			const now = new Date().toISOString();
			const events: TaskBusEvent[] = [];
			const tasks = file.tasks.map((t) => {
				if (!ids.includes(t.id) || t.status !== 'reporting') return t;
				count += 1;
				const updated: TaskRecord = { ...t, status: 'reported', reportedAt: now, updatedAt: now };
				delete updated.result;
				events.push({ type: 'task.reported', id: t.id });
				return updated;
			});
			return { file: { version: 1, tasks }, result: count, events };
		});
		if (!result.ok) return json({ ok: false, code: result.code }, { status: 503 });
		return json({ ok: true, count: result.result });
	}

	// release
	const result = await mutateTasks<number>(binding.id, (file) => {
		let count = 0;
		const now = new Date().toISOString();
		const events: TaskBusEvent[] = [];
		const tasks = file.tasks.map((t) => {
			if (!ids.includes(t.id) || t.status !== 'reporting') return t;
			count += 1;

			if (spoken) {
				const attempts = t.attempts + 1;
				if (attempts >= MAX_REPORT_ATTEMPTS) {
					// Exhausted retries — give up cleanly, same as confirm.
					const updated: TaskRecord = {
						...t,
						status: 'reported',
						attempts,
						reportedAt: now,
						updatedAt: now
					};
					delete updated.result;
					events.push({ type: 'task.reported', id: t.id });
					return updated;
				}
				const restoredStatus = t.outcome ?? 'failed';
				const updated: TaskRecord = { ...t, status: restoredStatus, attempts, updatedAt: now };
				events.push(
					restoredStatus === 'done'
						? { type: 'task.done', task: toPublicTask(updated) }
						: { type: 'task.failed', task: toPublicTask(updated) }
				);
				return updated;
			}

			// spoken !== true: restore unconditionally, do NOT touch attempts.
			const restoredStatus = t.outcome ?? 'failed';
			const updated: TaskRecord = { ...t, status: restoredStatus, updatedAt: now };
			events.push(
				restoredStatus === 'done'
					? { type: 'task.done', task: toPublicTask(updated) }
					: { type: 'task.failed', task: toPublicTask(updated) }
			);
			return updated;
		});
		return { file: { version: 1, tasks }, result: count, events };
	});
	if (!result.ok) return json({ ok: false, code: result.code }, { status: 503 });
	return json({ ok: true, count: result.result });
};
