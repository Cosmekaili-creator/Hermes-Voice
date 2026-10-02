/**
 * Task orbit state — the client-side picture of background tasks drawn as satellites
 * around the orb. Pure reducers over the existing task stream (snapshot + bus events), so
 * the orbit can never disagree with what the server reports.
 */
import type { ResultCard } from '$lib/cards';
import type { PublicTask, TaskBusEvent } from '$lib/server/tasks/types';
import { formatHermesToolActivity } from './captionTruncate';

export type OrbitStatus = 'queued' | 'running' | 'done' | 'failed';

export type OrbitTask = {
	id: string;
	title: string;
	status: OrbitStatus;
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	failureCode?: string;
	/** Most recent tool-progress labels, oldest first (capped). */
	progress: string[];
	cards?: ResultCard[];
};

export const MAX_ORBIT_TASKS = 8;
const MAX_PROGRESS = 6;

/** Only states a person would want to see: in flight, or finished and not yet heard. */
function orbitStatus(task: PublicTask): OrbitStatus | null {
	switch (task.status) {
		case 'queued':
		case 'running':
			return task.status;
		case 'done':
		case 'failed':
		case 'reporting':
			return task.outcome === 'failed' || task.status === 'failed' ? 'failed' : 'done';
		default:
			return null;
	}
}

function fromPublic(task: PublicTask, prev?: OrbitTask): OrbitTask | null {
	const status = orbitStatus(task);
	if (!status) return null;
	return {
		id: task.id,
		title: task.title,
		status,
		createdAt: task.createdAt,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		failureCode: task.failureCode,
		progress: prev?.progress ?? [],
		cards: task.cards ?? prev?.cards
	};
}

function capList(list: OrbitTask[]): OrbitTask[] {
	return list.length > MAX_ORBIT_TASKS ? list.slice(-MAX_ORBIT_TASKS) : list;
}

export function orbitFromSnapshot(tasks: PublicTask[], prev: OrbitTask[] = []): OrbitTask[] {
	const byId = new Map(prev.map((t) => [t.id, t]));
	const out: OrbitTask[] = [];
	for (const task of tasks) {
		const next = fromPublic(task, byId.get(task.id));
		if (next) out.push(next);
	}
	out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return capList(out);
}

export function applyOrbitEvent(list: OrbitTask[], ev: TaskBusEvent): OrbitTask[] {
	switch (ev.type) {
		case 'task.queued':
		case 'task.running':
		case 'task.done':
		case 'task.failed': {
			const idx = list.findIndex((t) => t.id === ev.task.id);
			const next = fromPublic(ev.task, idx >= 0 ? list[idx] : undefined);
			if (!next) return idx >= 0 ? list.filter((t) => t.id !== ev.task.id) : list;
			if (idx < 0) return capList([...list, next]);
			const copy = list.slice();
			copy[idx] = next;
			return copy;
		}
		case 'task.progress': {
			const idx = list.findIndex((t) => t.id === ev.id);
			if (idx < 0) return list;
			const label = formatHermesToolActivity(ev.tool, ev.label);
			const cur = list[idx]!;
			if (cur.progress[cur.progress.length - 1] === label) return list;
			const copy = list.slice();
			copy[idx] = { ...cur, progress: [...cur.progress, label].slice(-MAX_PROGRESS) };
			return copy;
		}
		case 'task.reported':
			return list.filter((t) => t.id !== ev.id);
		case 'task.cleared':
			return list.filter((t) => !ev.ids.includes(t.id));
	}
}
