/** Stable multi-line caption layout — lines freeze once wrapped; no rolling text. */

export type CaptionLineView = {
	id: number;
	text: string;
	/** Third-from-newest visible line — 50% opacity before it exits. */
	soft: boolean;
};

/** ~10 words / line at Lounge caption width (~28rem / 0.88rem type). */
export const CAPTION_CHARS_PER_LINE = 58;
/** Two full lines + one fading predecessor. */
export const CAPTION_WINDOW = 3;

/**
 * Length of the first wrapped line within `chunk` (exclusive end index).
 * Prefers a word boundary; hard-wraps very long tokens.
 */
export function firstLineLength(chunk: string, maxChars = CAPTION_CHARS_PER_LINE): number {
	if (chunk.length <= maxChars) return chunk.length;
	const slice = chunk.slice(0, maxChars);
	const sp = slice.lastIndexOf(' ');
	if (sp >= Math.floor(maxChars * 0.4)) return sp;
	return maxChars;
}

/**
 * Extend committed line-break offsets as `text` grows.
 * Breaks are exclusive indices into `text`; once set they never move (stable lines).
 */
export function advanceCaptionBreaks(
	text: string,
	breaks: readonly number[],
	maxChars = CAPTION_CHARS_PER_LINE
): number[] {
	const next = breaks.filter((b) => b > 0 && b <= text.length);
	let start = 0;
	if (next.length > 0) {
		start = next[next.length - 1]!;
		while (start < text.length && text[start] === ' ') start += 1;
	}

	while (start < text.length) {
		const chunk = text.slice(start);
		if (chunk.length <= maxChars) break;
		const len = firstLineLength(chunk, maxChars);
		if (len <= 0) break;
		const end = start + len;
		next.push(end);
		start = end;
		while (start < text.length && text[start] === ' ') start += 1;
	}
	return next;
}

/** Split `text` into frozen completed lines + current growing line. */
export function linesFromBreaks(text: string, breaks: readonly number[]): string[] {
	const lines: string[] = [];
	let start = 0;
	for (const end of breaks) {
		const line = text.slice(start, end).replace(/\s+$/u, '');
		if (line) lines.push(line);
		start = end;
		while (start < text.length && text[start] === ' ') start += 1;
	}
	if (start < text.length) {
		lines.push(text.slice(start));
	}
	return lines;
}

/**
 * Last up to 3 lines: newest two at full opacity; the one before that is soft (50%).
 * `id` is the stable line index in the utterance (for keyed transitions).
 */
export function windowCaptionLines(allLines: readonly string[]): CaptionLineView[] {
	const total = allLines.length;
	if (total === 0) return [];
	const from = Math.max(0, total - CAPTION_WINDOW);
	const out: CaptionLineView[] = [];
	for (let i = from; i < total; i += 1) {
		const distFromEnd = total - 1 - i;
		out.push({
			id: i,
			text: allLines[i]!,
			soft: distFromEnd === 2
		});
	}
	return out;
}
