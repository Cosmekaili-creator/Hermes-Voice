import { describe, expect, it } from 'vitest';
import type { PublicTask } from '$lib/server/tasks/types';
import { applyOrbitEvent, orbitFromSnapshot } from './orbit';

function task(
	id: string,
	status: PublicTask['status'],
	extra: Partial<PublicTask> = {}
): PublicTask {
	const now = new Date(
		Date.UTC(2026, 0, 1, 0, 0, Number(id.replace(/\D/g, '')) || 0)
	).toISOString();
	return { id, title: `t${id}`, status, outcome: null, createdAt: now, updatedAt: now, ...extra };
}

describe('orbit reducers', () => {
	it('keeps in-flight and unheard results, drops reported ones, sorted by creation', () => {
		const list = orbitFromSnapshot([
			task('3', 'queued'),
			task('1', 'running'),
			task('2', 'done', { outcome: 'done' }),
			task('4', 'reported', { outcome: 'done' })
		]);
		expect(list.map((t) => [t.id, t.status])).toEqual([
			['1', 'running'],
			['2', 'done'],
			['3', 'queued']
		]);
	});

	it('tracks progress labels without duplicates and removes cleared/reported tasks', () => {
		let list = applyOrbitEvent([], { type: 'task.running', task: task('1', 'running') });
		list = applyOrbitEvent(list, { type: 'task.progress', id: '1', tool: 'web_search' });
		list = applyOrbitEvent(list, { type: 'task.progress', id: '1', tool: 'web_search' });
		expect(list[0]!.progress).toHaveLength(1);
		list = applyOrbitEvent(list, {
			type: 'task.failed',
			task: task('1', 'failed', { outcome: 'failed' })
		});
		expect(list[0]!.status).toBe('failed');
		expect(list[0]!.progress).toHaveLength(1);
		expect(applyOrbitEvent(list, { type: 'task.cleared', ids: ['1'] })).toEqual([]);
		expect(applyOrbitEvent(list, { type: 'task.reported', id: '1' })).toEqual([]);
	});
});
