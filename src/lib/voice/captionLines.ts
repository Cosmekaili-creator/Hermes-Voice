/** Stable multi-line caption layout — lines freeze once wrapped; no rolling text. */

export type CaptionLineView = {
	id: number;
	text: string;
	/** Oldest visible line, only when older lines were dropped — 50% opacity fade cue. */
	soft: boolean;
};

/** ~10 words / line at Lounge caption width (~28rem / 0.88rem type). */
export const CAPTION_CHARS_PER_LINE = 58;
/** Retained caption lines for the current reply; CSS caps how many are visible + scrolls. */
export const CAPTION_WINDOW = 12;

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
 * Last up to `window` lines. The oldest visible line is soft (50%) only when
 * older lines were dropped — a fade cue that content scrolled out of retention.
 */
export function windowCaptionLines(
	allLines: readonly string[],
	window = CAPTION_WINDOW
): CaptionLineView[] {
	const total = allLines.length;
	if (total === 0) return [];
	const from = Math.max(0, total - window);
	const out: CaptionLineView[] = [];
	for (let i = from; i < total; i += 1) {
		out.push({
			id: i,
			text: allLines[i]!,
			soft: i === from && from > 0
		});
	}
	return out;
}
