import { json, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { subscribe, subscriberCount } from '$lib/server/tasks/bus.server';
import { HEARTBEAT_MS, MAX_SUBSCRIBERS_PER_BINDING } from '$lib/server/tasks/constants';
import { reconcileStale, readTasks } from '$lib/server/tasks/store.server';
import { toPublicTask, type TaskBusEvent } from '$lib/server/tasks/types';

/** Only events carrying a `.task` (queued/running/done/failed) can be deduped against the
 * snapshot; task.progress/task.reported/task.cleared don't and are always forwarded. */
function snapshotDedupeKey(ev: TaskBusEvent): string | null {
	if (
		ev.type === 'task.queued' ||
		ev.type === 'task.running' ||
		ev.type === 'task.done' ||
		ev.type === 'task.failed'
	) {
		return `${ev.task.id}:${ev.task.status}:${ev.task.updatedAt}`;
	}
	return null;
}

/**
 * SSE, auth via fetch()+stream-reading (not a bare <EventSource> tag — same convention
 * runHermesBridge already uses for /api/hermes), so normal cookie/header auth applies.
 *
 * Critical ordering, fixing a real bug the plan's QC pass found: subscribe to the bus
 * BEFORE reading the snapshot, buffer everything that arrives during that window, then
 * flush the buffer (deduped against what the snapshot already reflects) after the
 * snapshot is sent. Reversing this order would lose any event published between the read
 * and the subscribe call.
 */
export const GET: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const binding = await requireVoiceKey(event);
	enforceRateLimit(event, 'tasks', RATE.tasks.limit, RATE.tasks.windowMs, binding.id);

	// Reject before opening a stream at all, if possible — cheaper than erroring inside a
	// ReadableStream. The check inside start() (subscribe() returning null) is the
	// authoritative guard for the race between this check and the actual subscribe call.
	if (subscriberCount(binding.id) >= MAX_SUBSCRIBERS_PER_BINDING) {
		return json({ ok: false, code: 'too_many_streams' }, { status: 503 });
	}

	const encoder = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | null = null;
	let cleanedUp = false;

	const cleanup = () => {
		// signal 'abort' and cancel() are not guaranteed to both fire in every runtime —
		// this guard covers both paths without double-cleanup.
		if (cleanedUp) return;
		cleanedUp = true;
		if (heartbeat) clearInterval(heartbeat);
		unsubscribe?.();
	};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (name: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					/* controller already closed */
				}
			};

			let flushing = true;
			const buffered: TaskBusEvent[] = [];

			// 1. SUBSCRIBE FIRST.
			unsubscribe = subscribe(binding.id, (ev) => {
				if (flushing) buffered.push(ev);
				else send(ev.type, ev);
			});
			if (!unsubscribe) {
				send('error', { code: 'too_many_streams' });
				try {
					controller.close();
				} catch {
					/* ignore */
				}
				return;
			}

			// 2. reconcile — may itself publish; that publish lands in `buffered` too, correctly.
			await reconcileStale(binding.id);

			// 3. read + emit snapshot.
			const result = await readTasks(binding.id);
			const tasks = result.ok ? result.file.tasks.map(toPublicTask) : [];
			const inFlight = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
			send('snapshot', { tasks, inFlight });

			// 4. flush buffered events, deduped against what the snapshot already reflects.
			flushing = false;
			const snapshotKeys = new Set(tasks.map((t) => `${t.id}:${t.status}:${t.updatedAt}`));
			for (const ev of buffered) {
				const key = snapshotDedupeKey(ev);
				if (key && snapshotKeys.has(key)) continue;
				send(ev.type, ev);
			}

			// 5. heartbeat — data-free, no store read.
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					cleanup();
				}
			}, HEARTBEAT_MS);

			event.request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			});
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
