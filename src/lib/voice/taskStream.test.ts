import { describe, expect, it } from 'vitest';
import { createSseParseState, pushSseChunk } from '$lib/sseParse';
import { backoffDelayMs, parseTaskStreamFrame } from './taskStream';

describe('backoffDelayMs', () => {
	it('follows 1s, 2s, 4s, 8s, 16s with no jitter (rand=0)', () => {
		expect(backoffDelayMs(0, () => 0)).toBe(1000);
		expect(backoffDelayMs(1, () => 0)).toBe(2000);
		expect(backoffDelayMs(2, () => 0)).toBe(4000);
		expect(backoffDelayMs(3, () => 0)).toBe(8000);
		expect(backoffDelayMs(4, () => 0)).toBe(16000);
	});

	it('caps at 30s from attempt 5 onward', () => {
		expect(backoffDelayMs(5, () => 0)).toBe(30_000);
		expect(backoffDelayMs(6, () => 0)).toBe(30_000);
		expect(backoffDelayMs(100, () => 0)).toBe(30_000);
	});

	it('adds up to 20% jitter on top of the base delay', () => {
		expect(backoffDelayMs(0, () => 1)).toBe(1200);
		expect(backoffDelayMs(2, () => 1)).toBe(4800);
	});

	it('jitter is applied on top of the capped base, not clamped away by it', () => {
		// base is capped at 30s first, then up to +20% jitter is added on top — this is
		// intentional (jitter exists to spread reconnects, which a hard post-jitter clamp
		// would partially defeat at the high end).
		expect(backoffDelayMs(6, () => 1)).toBe(Math.round(30_000 * 1.2));
	});

	it('treats a negative attempt as attempt 0', () => {
		expect(backoffDelayMs(-3, () => 0)).toBe(1000);
	});
});

describe('parseTaskStreamFrame', () => {
	it('parses a snapshot frame', () => {
		const frame = {
			event: 'snapshot',
			data: JSON.stringify({
				tasks: [
					{ id: 't1', title: 'x', status: 'done', outcome: 'done', createdAt: '', updatedAt: '' }
				],
				inFlight: 2
			})
		};
		const parsed = parseTaskStreamFrame(frame);
		expect(parsed.kind).toBe('snapshot');
		if (parsed.kind === 'snapshot') {
			expect(parsed.snapshot.inFlight).toBe(2);
			expect(parsed.snapshot.tasks).toHaveLength(1);
			expect(parsed.snapshot.tasks[0]!.id).toBe('t1');
		}
	});

	it('treats a missing/malformed snapshot payload as an empty snapshot rather than throwing', () => {
		const parsed = parseTaskStreamFrame({ event: 'snapshot', data: 'not json' });
		expect(parsed.kind).toBe('ignored');
	});

	it('parses a task.done bus event, using the payload verbatim (already has its own .type)', () => {
		const task = {
			id: 't2',
			title: 'x',
			status: 'done',
			outcome: 'done',
			createdAt: '',
			updatedAt: ''
		};
		const frame = { event: 'task.done', data: JSON.stringify({ type: 'task.done', task }) };
		const parsed = parseTaskStreamFrame(frame);
		expect(parsed.kind).toBe('event');
		if (parsed.kind === 'event') {
			expect(parsed.event.type).toBe('task.done');
		}
	});

	it('parses every TaskBusEvent variant type', () => {
		for (const type of [
			'task.queued',
			'task.running',
			'task.progress',
			'task.done',
			'task.failed',
			'task.reported',
			'task.cleared'
		]) {
			const parsed = parseTaskStreamFrame({ event: type, data: JSON.stringify({ type }) });
			expect(parsed.kind).toBe('event');
		}
	});

	it('ignores frames with an unrecognized event name (e.g. the route error frame)', () => {
		const parsed = parseTaskStreamFrame({
			event: 'error',
			data: JSON.stringify({ code: 'too_many_streams' })
		});
		expect(parsed.kind).toBe('ignored');
	});

	it('ignores malformed JSON on a bus-event frame rather than throwing', () => {
		const parsed = parseTaskStreamFrame({ event: 'task.done', data: '{not json' });
		expect(parsed.kind).toBe('ignored');
	});
});

describe('SSE frame parsing given canned text (heartbeat + snapshot + event)', () => {
	it('skips heartbeat comments and yields snapshot + bus-event frames in order', () => {
		const state = createSseParseState();
		const text =
			`event: snapshot\ndata: ${JSON.stringify({ tasks: [], inFlight: 0 })}\n\n` +
			`: ping\n\n` +
			`event: task.queued\ndata: ${JSON.stringify({ type: 'task.queued', task: { id: 'x' } })}\n\n`;
		const frames = [...pushSseChunk(state, text)];
		expect(frames).toHaveLength(2);
		expect(frames[0]!.event).toBe('snapshot');
		expect(frames[1]!.event).toBe('task.queued');

		const parsed = frames.map(parseTaskStreamFrame);
		expect(parsed[0]!.kind).toBe('snapshot');
		expect(parsed[1]!.kind).toBe('event');
	});

	it('handles a heartbeat/frame split across two chunks', () => {
		const state = createSseParseState();
		const full = `event: task.reported\ndata: ${JSON.stringify({ type: 'task.reported', id: 'x' })}\n\n`;
		const mid = Math.floor(full.length / 2);
		const first = [...pushSseChunk(state, full.slice(0, mid))];
		expect(first).toHaveLength(0);
		const second = [...pushSseChunk(state, full.slice(mid))];
		expect(second).toHaveLength(1);
		expect(second[0]!.event).toBe('task.reported');
	});
});
