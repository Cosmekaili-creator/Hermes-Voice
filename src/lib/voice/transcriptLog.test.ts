import { describe, expect, it } from 'vitest';
import {
	createTranscriptLog,
	MAX_TRANSCRIPT_CHARS,
	MAX_TRANSCRIPT_TURNS,
	MAX_TURN_CHARS,
	MIN_REVIEW_USER_CHARS,
	readUserTranscriptEvent
} from './transcriptLog';

describe('readUserTranscriptEvent', () => {
	it('parses a delta event as append-mode, reading the delta field', () => {
		const parsed = readUserTranscriptEvent({
			type: 'conversation.item.input_audio_transcription.delta',
			item_id: 'item-1',
			delta: 'hel'
		});
		expect(parsed).toEqual({ key: 'item-1', text: 'hel', mode: 'append' });
	});

	it('parses an updated event (xAI cumulative) as replace-mode, reading the transcript field', () => {
		const parsed = readUserTranscriptEvent({
			type: 'conversation.item.input_audio_transcription.updated',
			item_id: 'item-1',
			transcript: 'hello there'
		});
		expect(parsed).toEqual({ key: 'item-1', text: 'hello there', mode: 'replace' });
	});

	it('parses a completed event (OpenAI) as replace-mode, reading the text field', () => {
		const parsed = readUserTranscriptEvent({
			type: 'conversation.item.input_audio_transcription.completed',
			item_id: 'item-2',
			text: 'goodbye'
		});
		expect(parsed).toEqual({ key: 'item-2', text: 'goodbye', mode: 'replace' });
	});

	it('returns null for an unrelated event type', () => {
		expect(
			readUserTranscriptEvent({ type: 'response.output_audio_transcript.delta', delta: 'hi' })
		).toBeNull();
	});

	it('returns null when no field has usable text', () => {
		expect(
			readUserTranscriptEvent({ type: 'conversation.item.input_audio_transcription.updated' })
		).toBeNull();
		expect(
			readUserTranscriptEvent({
				type: 'conversation.item.input_audio_transcription.updated',
				transcript: ''
			})
		).toBeNull();
	});

	it('falls back to item_id sentinel when item_id is absent', () => {
		const parsed = readUserTranscriptEvent({
			type: 'conversation.item.input_audio_transcription.updated',
			transcript: 'hi'
		});
		expect(parsed?.key).toBe('pending-user');
	});

	it('falls through transcript -> text -> delta, first non-empty string wins', () => {
		const parsed = readUserTranscriptEvent({
			type: 'conversation.item.input_audio_transcription.updated',
			transcript: '',
			text: 'fallback text',
			item_id: 'x'
		});
		expect(parsed?.text).toBe('fallback text');
	});
});

describe('createTranscriptLog', () => {
	it('cumulative replace overwrites rather than concatenates', () => {
		const log = createTranscriptLog();
		log.noteUserTranscript('a', 'hel', 'replace');
		log.noteUserTranscript('a', 'hello', 'replace');
		log.noteUserTranscript('a', 'hello there', 'replace');
		const turns = log.takeTurns();
		expect(turns).toEqual([{ role: 'user', text: 'hello there' }]);
	});

	it('append concatenates onto the existing slot text', () => {
		const log = createTranscriptLog();
		log.noteUserTranscript('a', 'hel', 'append');
		log.noteUserTranscript('a', 'lo ', 'append');
		log.noteUserTranscript('a', 'there', 'append');
		const turns = log.takeTurns();
		expect(turns).toEqual([{ role: 'user', text: 'hello there' }]);
	});

	it('QC M2: an empty replace call preserves whatever was already appended, never wipes it', () => {
		const log = createTranscriptLog();
		log.noteUserTranscript('a', 'hello', 'append');
		log.noteUserTranscript('a', 'hello there', 'append');
		// Malformed/empty cumulative event for the same slot — must be a no-op.
		log.noteUserTranscript('a', '', 'replace');
		const turns = log.takeTurns();
		expect(turns).toEqual([{ role: 'user', text: 'hellohello there' }]);
	});

	it('an empty append call is also a no-op', () => {
		const log = createTranscriptLog();
		log.noteUserTranscript('a', 'hello', 'append');
		log.noteUserTranscript('a', '', 'append');
		const turns = log.takeTurns();
		expect(turns).toEqual([{ role: 'user', text: 'hello' }]);
	});

	it('a user turn occupies the position where its key was first seen', () => {
		const log = createTranscriptLog();
		log.noteUserTranscript('a', 'first', 'replace');
		log.appendAssistantDelta('reply one');
		log.commitAssistant();
		log.noteUserTranscript('b', 'second', 'replace');
		// Updating the still-live key 'a' again must update in place, not move to the end.
		log.noteUserTranscript('a', 'first updated', 'replace');
		const turns = log.takeTurns();
		expect(turns).toEqual([
			{ role: 'user', text: 'first updated' },
			{ role: 'assistant', text: 'reply one' },
			{ role: 'user', text: 'second' }
		]);
	});

	it('commitAssistant freezes a pending-user slot so a late transcription cannot land after the reply', () => {
		const log = createTranscriptLog();
		// No item_id yet -> sentinel key.
		log.noteUserTranscript('pending-user', 'what is the weather', 'replace');
		log.appendAssistantDelta("it's sunny");
		log.commitAssistant();
		// A late-arriving event for the *next* utterance also has no item_id yet.
		log.noteUserTranscript('pending-user', 'and tomorrow', 'replace');
		log.appendAssistantDelta('also sunny');
		log.commitAssistant();
		const turns = log.takeTurns();
		expect(turns).toEqual([
			{ role: 'user', text: 'what is the weather' },
			{ role: 'assistant', text: "it's sunny" },
			{ role: 'user', text: 'and tomorrow' },
			{ role: 'assistant', text: 'also sunny' }
		]);
	});

	it('a typed turn (noteUserText) is a discrete turn, trimmed, never merged', () => {
		const log = createTranscriptLog();
		log.noteUserText('  hello there  ');
		log.noteUserText('');
		log.noteUserText('   ');
		const turns = log.takeTurns();
		expect(turns).toEqual([{ role: 'user', text: 'hello there' }]);
	});

	it('truncates a single turn at MAX_TURN_CHARS', () => {
		const log = createTranscriptLog();
		const long = 'x'.repeat(MAX_TURN_CHARS + 500);
		log.noteUserTranscript('a', long, 'replace');
		const turns = log.takeTurns();
		expect(turns[0].text.length).toBe(MAX_TURN_CHARS);
	});

	it('evicts oldest turns first once MAX_TRANSCRIPT_TURNS is exceeded', () => {
		const log = createTranscriptLog();
		for (let i = 0; i < MAX_TRANSCRIPT_TURNS + 10; i++) {
			log.noteUserText(`turn number ${i}`);
		}
		const turns = log.takeTurns();
		expect(turns.length).toBe(MAX_TRANSCRIPT_TURNS);
		// Oldest (turn number 0..9) evicted; the earliest surviving turn is #10.
		expect(turns[0].text).toBe('turn number 10');
		expect(turns[turns.length - 1].text).toBe(`turn number ${MAX_TRANSCRIPT_TURNS + 9}`);
	});

	it('evicts oldest turns first once MAX_TRANSCRIPT_CHARS is exceeded', () => {
		const log = createTranscriptLog();
		const chunk = 'y'.repeat(1000); // well under MAX_TURN_CHARS, many turns needed to exceed char cap
		const turnsToWrite = Math.ceil(MAX_TRANSCRIPT_CHARS / 1000) + 5;
		for (let i = 0; i < turnsToWrite; i++) {
			log.noteUserText(`${chunk}-${i}`);
		}
		const turns = log.takeTurns();
		const total = turns.reduce((sum, t) => sum + t.text.length, 0);
		expect(total).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
		// The earliest turns must have been evicted, not the latest.
		expect(turns[turns.length - 1].text.endsWith(`-${turnsToWrite - 1}`)).toBe(true);
		expect(turns[0].text.endsWith('-0')).toBe(false);
	});

	it('hasReviewableContent is false with no user turns', () => {
		const log = createTranscriptLog();
		log.appendAssistantDelta('hello');
		log.commitAssistant();
		expect(log.hasReviewableContent()).toBe(false);
	});

	it('hasReviewableContent is false below MIN_REVIEW_USER_CHARS', () => {
		const log = createTranscriptLog();
		log.noteUserText('short');
		expect(log.hasReviewableContent()).toBe(false);
	});

	it('hasReviewableContent is true once combined user text reaches MIN_REVIEW_USER_CHARS', () => {
		const log = createTranscriptLog();
		log.noteUserText('x'.repeat(MIN_REVIEW_USER_CHARS));
		expect(log.hasReviewableContent()).toBe(true);
	});

	it('takeTurns is atomic — a second immediate call returns an empty array', () => {
		const log = createTranscriptLog();
		log.noteUserText('hello there, this is a longer message');
		const first = log.takeTurns();
		expect(first.length).toBe(1);
		const second = log.takeTurns();
		expect(second).toEqual([]);
	});

	it('clear() empties the log and resets reviewability', () => {
		const log = createTranscriptLog();
		log.noteUserText('x'.repeat(MIN_REVIEW_USER_CHARS));
		expect(log.hasReviewableContent()).toBe(true);
		log.clear();
		expect(log.hasReviewableContent()).toBe(false);
		expect(log.takeTurns()).toEqual([]);
	});
});
