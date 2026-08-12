import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { requireVoiceKey } from '$lib/server/auth';
import { MAX_HERMES_REQUEST_CHARS } from '$lib/server/hermes';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { subscribe } from '$lib/server/tasks/bus.server';
import {
	DISPATCH_WAIT_MS_DEFAULT,
	DISPATCH_WAIT_MS_MAX,
	MAX_QUEUED_PER_BINDING,
	MAX_TASK_TITLE_CHARS
} from '$lib/server/tasks/constants';
import { scheduleBinding } from '$lib/server/tasks/runner.server';
import { claimTasks, mutateTasks, readTasks } from '$lib/server/tasks/store.server';
import { toPublicTask, type TaskBusEvent, type TaskRecord } from '$lib/server/tasks/types';

function isAsyncTasksEnabled(): boolean {
	// Default ON — matches the confirmed product decision (VOICE_ASYNC_TASKS defaults to
	// '1'); same process.env-first convention as every other feature-gate env read
	// (readEnvTrimmed — see active.server.ts's VOICE_PROVIDER read for the pattern).
	return readEnvTrimmed('VOICE_ASYNC_TASKS') !== '0';
}

// C0 + C1 control characters — same discipline as sanitizeGreetingText/sanitizeTranscriptTurns.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F-\x9F]/g;

function stripControlChars(value: string): string {
	return value.replace(CONTROL_CHARS_RE, ' ');
}

function truncateOnWordBoundary(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

function sanitizeTitle(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const stripped = stripControlChars(raw).replace(/\s+/g, ' ').trim();
	return truncateOnWordBoundary(stripped, MAX_TASK_TITLE_CHARS);
}

/** Also strips literal `<<<`/`>>>` so a task brief can never forge a quarantine marker
 * later when the *result* is fenced (same guard sanitizeGreetingText/sanitizeTranscriptTurns
 * apply to model-echoed text). */
function sanitizeRequest(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	let text = stripControlChars(raw);
	text = text.replaceAll('<<<', '').replaceAll('>>>', '');
	text = text.replace(/\s+/g, ' ').trim();
	return truncateOnWordBoundary(text, MAX_HERMES_REQUEST_CHARS);
}

/**
 * Races a promise that resolves `true` once `taskId` reaches a terminal bus event
 * (task.done / task.failed), against `waitMs`. Subscribes temporarily and always
 * unsubscribes on settle — this temporary subscription counts against
 * MAX_SUBSCRIBERS_PER_BINDING like any other, so a saturated binding (many stream tabs
 * open) simply falls back to `mode: 'queued'` rather than waiting, which is the correct
 * degrade.
 */
function raceForTerminal(bindingId: string, taskId: string, waitMs: number): Promise<boolean> {
	if (waitMs <= 0) return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			unsubscribe?.();
			resolve(false);
		}, waitMs);
		const unsubscribe = subscribe(bindingId, (ev: TaskBusEvent) => {
			if (settled) return;
			if ((ev.type === 'task.done' || ev.type === 'task.failed') && ev.task.id === taskId) {
				settled = true;
				clearTimeout(timer);
				unsubscribe?.();
				resolve(true);
			}
		});
		if (!unsubscribe) {
			settled = true;
			clearTimeout(timer);
			resolve(false);
		}
	});
}

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'tasks', RATE.tasks.limit, RATE.tasks.windowMs, binding.id);

	if (!isAsyncTasksEnabled()) {
		return json({ ok: false, code: 'feature_disabled' }, { status: 503 });
	}

	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const title = sanitizeTitle(b.title);
	const request = sanitizeRequest(b.request);
	if (!request) {
		return json({ ok: false, code: 'empty_request' }, { status: 400 });
	}

	// Reconciliation not required here, just a plain read — the stream route is what needs
	// freshness; a brief TOCTOU window on the cap check is acceptable.
	const existing = await readTasks(binding.id);
	if (!existing.ok) {
		return json({ ok: false, code: 'store_unavailable' }, { status: 503 });
	}
	const activeCount = existing.file.tasks.filter(
		(t) => t.status === 'queued' || t.status === 'running'
	).length;
	if (activeCount >= MAX_QUEUED_PER_BINDING) {
		// 200, not an error status — this becomes a spoken function-output on the client.
		return json({ ok: false, code: 'queue_full' }, { status: 200 });
	}

	const now = new Date().toISOString();
	const taskId = randomUUID();
	const record: TaskRecord = {
		id: taskId,
		title: title || 'Task',
		request,
		status: 'queued',
		outcome: null,
		runAttempts: 0,
		attempts: 0,
		createdAt: now,
		updatedAt: now
	};

	const written = await mutateTasks(binding.id, (file) => {
		const tasks = [...file.tasks, record];
		const events: TaskBusEvent[] = [{ type: 'task.queued', task: toPublicTask(record) }];
		return { file: { version: 1, tasks }, result: undefined, events };
	});
	if (!written.ok) {
		// Do NOT call scheduleBinding — the task was never actually persisted.
		return json({ ok: false, code: 'store_unavailable' }, { status: 503 });
	}

	scheduleBinding(binding.id);

	const requestedWaitMs =
		typeof b.waitMs === 'number' && Number.isFinite(b.waitMs) ? b.waitMs : DISPATCH_WAIT_MS_DEFAULT;
	const waitMs = Math.min(Math.max(0, requestedWaitMs), DISPATCH_WAIT_MS_MAX);

	const landedInTime = await raceForTerminal(binding.id, taskId, waitMs);
	if (landedInTime) {
		// Claim inline through the exact same CAS path /api/tasks/ack's `claim` mode uses.
		const claim = await claimTasks(binding.id, [taskId]);
		const claimedRecord = claim.ok ? claim.claimed.find((t) => t.id === taskId) : undefined;
		if (claimedRecord) {
			const payload: Record<string, unknown> = {
				ok: true,
				mode: 'inline',
				id: taskId,
				outcome: claimedRecord.outcome
			};
			if (claimedRecord.outcome === 'done') {
				payload.result = claimedRecord.result;
			} else {
				payload.failureCode = claimedRecord.failureCode;
				if (claimedRecord.result) payload.result = claimedRecord.result;
			}
			return json(payload, { status: 202 });
		}
		// Lost the claim race to another tab/consumer — fall through to queued mode; the
		// task is still in the store and will flow through the normal reporting path.
	}

	return json({ ok: true, mode: 'queued', id: taskId, title: record.title }, { status: 202 });
};
