/**
 * In-process pub/sub for task-store state changes, keyed strictly by `bindingId` — this
 * keying is the entire multi-user isolation guarantee for live delivery, so it must stay
 * exact: a subscriber registered for binding A must never receive an event published for
 * binding B.
 */
import { MAX_SUBSCRIBERS_PER_BINDING } from './constants';
import type { TaskBusEvent } from './types';

type Listener = (ev: TaskBusEvent) => void;

const subscribersByBinding = new Map<string, Set<Listener>>();
const activeUnsubscribes = new Set<() => void>();

/** Returns null when subscriberCount(bindingId) >= MAX_SUBSCRIBERS_PER_BINDING. */
export function subscribe(bindingId: string, fn: Listener): (() => void) | null {
	let set = subscribersByBinding.get(bindingId);
	if (!set) {
		set = new Set();
		subscribersByBinding.set(bindingId, set);
	}
	if (set.size >= MAX_SUBSCRIBERS_PER_BINDING) return null;

	set.add(fn);
	let active = true;
	const unsubscribe = () => {
		if (!active) return;
		active = false;
		const current = subscribersByBinding.get(bindingId);
		current?.delete(fn);
		if (current && current.size === 0) subscribersByBinding.delete(bindingId);
		activeUnsubscribes.delete(unsubscribe);
	};
	activeUnsubscribes.add(unsubscribe);
	return unsubscribe;
}

/** try/catch around each listener call — one throwing subscriber must not stop delivery
 * to the others. */
export function publish(bindingId: string, ev: TaskBusEvent): void {
	const set = subscribersByBinding.get(bindingId);
	if (!set) return;
	for (const fn of set) {
		try {
			fn(ev);
		} catch (err) {
			console.error('task bus subscriber threw', err);
		}
	}
}

export function subscriberCount(bindingId: string): number {
	return subscribersByBinding.get(bindingId)?.size ?? 0;
}

/** Calls every registered unsubscribe; used on shutdown. */
export function closeAllSubscribers(): void {
	for (const unsubscribe of [...activeUnsubscribes]) unsubscribe();
}

/**
 * Registered once, at module load: an open SSE connection counts as in-flight to
 * adapter-node's graceful shutdown handler, so without this every restart (including the
 * app's own owner-triggered self-restart) waits out the full SHUTDOWN_TIMEOUT.
 */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
	process.once(sig, closeAllSubscribers);
}
