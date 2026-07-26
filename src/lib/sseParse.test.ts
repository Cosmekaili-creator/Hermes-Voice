import { describe, expect, it } from 'vitest';
import { createSseParseState, pushSseChunk } from './sseParse';

describe('pushSseChunk', () => {
	it('parses hermes.tool.progress frames', () => {
		const state = createSseParseState();
		const frames = [
			...pushSseChunk(
				state,
				'event: hermes.tool.progress\ndata: {"tool":"web_search","status":"running"}\n\n'
			)
		];
		expect(frames).toEqual([
			{
				event: 'hermes.tool.progress',
				data: '{"tool":"web_search","status":"running"}'
			}
		]);
	});

	it('parses default data frames across chunks', () => {
		const state = createSseParseState();
		const a = [...pushSseChunk(state, 'data: {"choices":[{"delta":{"content":"po')];
		const b = [...pushSseChunk(state, 'ng"}}]}\n\n')];
		expect(a).toEqual([]);
		expect(b).toEqual([{ event: 'message', data: '{"choices":[{"delta":{"content":"pong"}}]}' }]);
	});
});
