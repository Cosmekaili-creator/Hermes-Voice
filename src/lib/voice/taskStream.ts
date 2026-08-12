/**
 * Client SSE consumer for GET /api/tasks/stream. Same fetch()+ReadableStream pattern
 * runHermesBridge() already uses for /api/hermes (see voiceSession.svelte.ts) — normal
 * cookie auth applies, not a bare <EventSource> tag.
 */
import { createSseParseState, pushSseChunk, type SseFrame } from '$lib/sseParse';
import type { PublicTask, TaskBusEvent } from '$lib/server/tasks/types';

const TASK_BUS_EVENT_TYPES = new Set<string>([
	'task.queued',
	'task.running',
	'task.progress',
	'task.done',
	'task.failed',
	'task.reported',
	'task.cleared'
]);

export type TaskStreamSnapshot = { tasks: PublicTask[]; inFlight: number };

export type ParsedTaskStreamFrame =
	| { kind: 'snapshot'; snapshot: TaskStreamSnapshot }
	| { kind: 'event'; event: TaskBusEvent }
	/** Heartbeat comments, malformed JSON, and any other frame we don't act on in v1
	 * (e.g. the route's own `event: error` frame on subscriber-cap rejection — the
	 * stream closing right after it is the actual signal, handled by the reconnect loop). */
	| { kind: 'ignored' };

/**
 * The server sends `data: JSON.stringify(ev)` where `ev` is the full `TaskBusEvent`
 * object, already including its own `.type` field (see routes/api/tasks/stream/+server.ts's
 * `send(ev.type, ev)`) — so `JSON.parse(frame.data)` alone is already a typed event, no
 * reconstruction from `frame.event` needed for the payload itself; `frame.event` is only
 * used here to decide *which* branch to parse into.
 */
export function parseTaskStreamFrame(frame: SseFrame): ParsedTaskStreamFrame {
	if (frame.event === 'snapshot') {
		try {
			const data = JSON.parse(frame.data) as { tasks?: unknown; inFlight?: unknown };
			const tasks = Array.isArray(data.tasks) ? (data.tasks as PublicTask[]) : [];
			const inFlight = typeof data.inFlight === 'number' ? data.inFlight : 0;
			return { kind: 'snapshot', snapshot: { tasks, inFlight } };
		} catch {
			return { kind: 'ignored' };
		}
	}
	if (TASK_BUS_EVENT_TYPES.has(frame.event)) {
		try {
			const event = JSON.parse(frame.data) as TaskBusEvent;
			return { kind: 'event', event };
		} catch {
			return { kind: 'ignored' };
		}
	}
	return { kind: 'ignored' };
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
/** attempt=0 -> 1s, 1 -> 2s, 2 -> 4s, 3 -> 8s, 4 -> 16s, 5+ -> capped 30s, plus up to 20% jitter. */
export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
	const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
	const jitter = base * 0.2 * Math.max(0, Math.min(1, rand()));
	return Math.round(base + jitter);
}

export type TaskStreamHandle = {
	start(): void;
	stop(): void;
	readonly open: boolean;
};

export function createTaskStream(opts: {
	onSnapshot: (tasks: PublicTask[], inFlight: number) => void;
	onEvent: (ev: TaskBusEvent) => void;
	onStatusChange?: (open: boolean) => void;
}): TaskStreamHandle {
	let controller: AbortController | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;
	/** True whenever the stream is not supposed to be running (before start(), after
	 * stop(), or permanently after a 401). start()'s idempotency check is `!stopped`. */
	let stopped = true;
	let open = false;
	/** Bumped on every start()/stop() so a stale in-flight read loop or reconnect timer
	 * from a previous generation can recognize it's superseded and become a no-op. */
	let generation = 0;

	function setOpen(next: boolean) {
		if (open === next) return;
		open = next;
		opts.onStatusChange?.(next);
	}

	function clearReconnectTimer() {
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function scheduleReconnect(myGen: number) {
		if (stopped || myGen !== generation) return;
		clearReconnectTimer();
		const delay = backoffDelayMs(attempt);
		attempt = Math.min(attempt + 1, 5);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (stopped || myGen !== generation) return;
			void runOnce(myGen);
		}, delay);
	}

	async function runOnce(myGen: number): Promise<void> {
		const ac = new AbortController();
		controller = ac;
		try {
			const res = await fetch('/api/tasks/stream', {
				method: 'GET',
				credentials: 'same-origin',
				headers: { Accept: 'text/event-stream' },
				signal: ac.signal
			});
			if (myGen !== generation) return;

			if (res.status === 401) {
				// Permanent — stop, do not reconnect.
				stopped = true;
				setOpen(false);
				return;
			}
			if (!res.ok || !res.body) {
				throw new Error(`taskStream: HTTP ${res.status}`);
			}

			setOpen(true);
			attempt = 0;

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			const sse = createSseParseState();

			while (true) {
				const { done, value } = await reader.read();
				if (myGen !== generation) return;
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				for (const frame of pushSseChunk(sse, chunk)) {
					if (myGen !== generation) return;
					const parsed = parseTaskStreamFrame(frame);
					if (parsed.kind === 'snapshot') {
						opts.onSnapshot(parsed.snapshot.tasks, parsed.snapshot.inFlight);
					} else if (parsed.kind === 'event') {
						opts.onEvent(parsed.event);
					}
				}
			}

			// Clean server-side close (e.g. subscriber-cap rejection, proxy idle-kill) is
			// still a disconnect from this client's point of view — fall through to the
			// reconnect path below via the catch block.
			throw new Error('taskStream: stream closed');
		} catch (err) {
			if (ac.signal.aborted) return; // intentional stop() — not a failure
			if (myGen !== generation) return;
			void err;
			setOpen(false);
			scheduleReconnect(myGen);
		} finally {
			if (controller === ac) controller = null;
		}
	}

	return {
		start() {
			if (!stopped) return; // idempotent — already started
			stopped = false;
			generation += 1;
			attempt = 0;
			void runOnce(generation);
		},
		stop() {
			stopped = true;
			generation += 1; // invalidates any in-flight read loop / pending reconnect
			clearReconnectTimer();
			try {
				controller?.abort();
			} catch {
				/* ignore */
			}
			controller = null;
			setOpen(false);
		},
		get open() {
			return open;
		}
	};
}
