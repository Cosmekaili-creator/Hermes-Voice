import { describe, expect, it } from 'vitest';
import {
	advanceCaptionBreaks,
	firstLineLength,
	linesFromBreaks,
	windowCaptionLines
} from './captionLines';

describe('firstLineLength', () => {
	it('returns full length when under max', () => {
		expect(firstLineLength('hello world', 40)).toBe(11);
	});

	it('breaks on a word boundary', () => {
		const text = 'alpha bravo charlie delta echo foxtrot';
		const len = firstLineLength(text, 20);
		expect(text.slice(0, len)).toBe('alpha bravo charlie');
		expect(text[len]).toBe(' ');
	});
});

describe('advanceCaptionBreaks + linesFromBreaks', () => {
	it('freezes completed lines as text grows', () => {
		const max = 12;
		let breaks: number[] = [];
		const t1 = 'hello world and more words here';
		breaks = advanceCaptionBreaks(t1.slice(0, 18), breaks, max);
		const lines1 = linesFromBreaks(t1.slice(0, 18), breaks);
		expect(lines1[0]).toBe('hello world');

		breaks = advanceCaptionBreaks(t1, breaks, max);
		const lines2 = linesFromBreaks(t1, breaks);
		expect(lines2[0]).toBe('hello world');
		expect(lines2[0]).toBe(lines1[0]);
	});

	it('never reflows already-committed lines when text grows', () => {
		let breaks: number[] = [];
		const base = 'one two three four five six seven';
		breaks = advanceCaptionBreaks(base, breaks, 10);
		const before = linesFromBreaks(base, breaks);
		const committedCount = before.length - 1; // exclude growing tail
		const longer = `${base} eight nine ten`;
		breaks = advanceCaptionBreaks(longer, breaks, 10);
		const after = linesFromBreaks(longer, breaks);
		expect(after.slice(0, committedCount)).toEqual(before.slice(0, committedCount));
		expect(after.join(' ')).toContain('eight');
	});
});

describe('windowCaptionLines', () => {
	it('marks only the third-from-newest as soft', () => {
		const views = windowCaptionLines(['a', 'b', 'c', 'd']);
		expect(views.map((v) => v.text)).toEqual(['b', 'c', 'd']);
		expect(views.map((v) => v.soft)).toEqual([true, false, false]);
		expect(views.map((v) => v.id)).toEqual([1, 2, 3]);
	});

	it('keeps two lines fully opaque', () => {
		const views = windowCaptionLines(['a', 'b']);
		expect(views.every((v) => !v.soft)).toBe(true);
	});
});
