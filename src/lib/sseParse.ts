/** Minimal SSE parser (client-safe) for Hermes upstream + Voice→browser bridge. */

export type SseFrame = {
	event: string;
	data: string;
};

/**
 * Feed decoded SSE text chunks; yield complete frames.
 * Handles `event:` + `data:` blocks separated by blank lines.
 */
export function* pushSseChunk(
	state: { buffer: string; event: string; dataLines: string[] },
	chunk: string
): Generator<SseFrame> {
	state.buffer += chunk;
	const parts = state.buffer.split('\n');
	state.buffer = parts.pop() ?? '';

	for (const rawLine of parts) {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		if (line === '') {
			if (state.dataLines.length > 0) {
				yield {
					event: state.event || 'message',
					data: state.dataLines.join('\n')
				};
			}
			state.event = '';
			state.dataLines = [];
			continue;
		}
		if (line.startsWith(':')) continue;
		if (line.startsWith('event:')) {
			state.event = line.slice(6).trim();
			continue;
		}
		if (line.startsWith('data:')) {
			const value = line.slice(5);
			state.dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
		}
	}
}

export function createSseParseState() {
	return { buffer: '', event: '', dataLines: [] as string[] };
}
