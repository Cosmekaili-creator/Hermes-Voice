import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { subscribe, subscriberCount, publish } from './bus.server';
import type { TaskBusEvent } from './types';

function ev(id: string): TaskBusEvent {
	return { type: 'task.reported', id };
}

describe('tasks bus — isolation', () => {
	it('a subscriber on binding A never receives a publish for binding B', () => {
		const bindingA = randomUUID();
		const bindingB = randomUUID();
		const receivedA: TaskBusEvent[] = [];
		const receivedB: TaskBusEvent[] = [];

		const unsubA = subscribe(bindingA, (e) => receivedA.push(e));
		const unsubB = subscribe(bindingB, (e) => receivedB.push(e));

		publish(bindingB, ev('task-b-1'));

		expect(receivedA).toEqual([]);
		expect(receivedB).toEqual([ev('task-b-1')]);

		unsubA?.();
		unsubB?.();
	});

	it('a throwing subscriber does not block delivery to others on the same binding', () => {
		const binding = randomUUID();
		const received: TaskBusEvent[] = [];

		const unsubThrower = subscribe(binding, () => {
			throw new Error('boom');
		});
		const unsubGood = subscribe(binding, (e) => received.push(e));

		expect(() => publish(binding, ev('t1'))).not.toThrow();
		expect(received).toEqual([ev('t1')]);

		unsubThrower?.();
		unsubGood?.();
	});

	it('subscriberCount accurately tracks subscribe/unsubscribe', () => {
		const binding = randomUUID();
		expect(subscriberCount(binding)).toBe(0);

		const unsub1 = subscribe(binding, () => {});
		expect(subscriberCount(binding)).toBe(1);

		const unsub2 = subscribe(binding, () => {});
		expect(subscriberCount(binding)).toBe(2);

		unsub1?.();
		expect(subscriberCount(binding)).toBe(1);

		unsub2?.();
		expect(subscriberCount(binding)).toBe(0);
	});

	it('unsubscribe is idempotent — calling it twice does not double-decrement the count', () => {
		const binding = randomUUID();
		const unsub = subscribe(binding, () => {});
		expect(subscriberCount(binding)).toBe(1);
		unsub?.();
		unsub?.();
		expect(subscriberCount(binding)).toBe(0);
	});

	it('the 5th subscribe attempt on one binding returns null (MAX_SUBSCRIBERS_PER_BINDING=4)', () => {
		const binding = randomUUID();
		const unsubs = [
			subscribe(binding, () => {}),
			subscribe(binding, () => {}),
			subscribe(binding, () => {}),
			subscribe(binding, () => {})
		];
		expect(unsubs.every((u) => u !== null)).toBe(true);

		const fifth = subscribe(binding, () => {});
		expect(fifth).toBeNull();

		for (const u of unsubs) u?.();
	});

	it('publish to a binding with no subscribers is a silent no-op', () => {
		expect(() => publish(randomUUID(), ev('t1'))).not.toThrow();
	});
});
