import { describe, expect, it } from 'vitest';
import {
	isBenignCancelError,
	isBenignResponseCollision,
	isOffline,
	sessionErrorForStatus,
	transportErrorCode
} from './sessionErrors';

describe('sessionErrorForStatus', () => {
	it('maps 401 to sessionUnauthorized', () => {
		expect(sessionErrorForStatus(401)).toBe('error.sessionUnauthorized');
	});

	it('maps 403 to sessionForbidden', () => {
		expect(sessionErrorForStatus(403)).toBe('error.sessionForbidden');
	});

	it('maps 429 to sessionRateLimited', () => {
		expect(sessionErrorForStatus(429)).toBe('error.sessionRateLimited');
	});

	it.each([500, 502, 503])('maps %i to sessionUnavailable', (status) => {
		expect(sessionErrorForStatus(status)).toBe('error.sessionUnavailable');
	});

	it.each([400, 404, 418])('maps %i to sessionRequestFailed', (status) => {
		expect(sessionErrorForStatus(status)).toBe('error.sessionRequestFailed');
	});
});

describe('isOffline', () => {
	it('returns false when navigator is unavailable (SSR-safe default)', () => {
		// The node vitest project has no navigator global — this is the real default.
		expect(isOffline()).toBe(false);
	});
});

describe('transportErrorCode', () => {
	it('returns networkFailed when navigator is unavailable (not positively offline)', () => {
		expect(transportErrorCode()).toBe('error.networkFailed');
	});
});

describe('isBenignCancelError', () => {
	it.each([
		'No active response found for conversation',
		'Cancellation failed: no response in progress',
		'NO ACTIVE RESPONSE'
	])('matches %s', (message) => {
		expect(isBenignCancelError(message)).toBe(true);
	});

	it('does not match an unrelated error message', () => {
		expect(isBenignCancelError('Invalid session token')).toBe(false);
	});
});

describe('isBenignResponseCollision', () => {
	it.each([
		'Conversation already has an active response',
		'the conversation already has an active response in progress',
		'ALREADY HAS AN ACTIVE RESPONSE'
	])('matches %s by message text', (message) => {
		expect(isBenignResponseCollision(message)).toBe(true);
	});

	it('matches by error code even with an unrelated message', () => {
		expect(
			isBenignResponseCollision(
				'something else entirely',
				'conversation_already_has_active_response'
			)
		).toBe(true);
	});

	it('does not match an unrelated message with no matching code', () => {
		expect(isBenignResponseCollision('Invalid session token', 'invalid_request')).toBe(false);
	});

	it('does not match when both message and code are absent/unrelated', () => {
		expect(isBenignResponseCollision('rate limited')).toBe(false);
	});

	it('does NOT match a bare "active response" substring without "already has"', () => {
		// Regression guard for the QC finding: the old bare `includes('active response')`
		// check would swallow any provider error whose text happens to contain that phrase —
		// e.g. a genuinely session-breaking "no active response to cancel" race or some
		// unrelated "active response timeout" error — silently treating it as benign instead
		// of surfacing it. Only the specific collision phrasing should match.
		expect(isBenignResponseCollision('ACTIVE RESPONSE in progress')).toBe(false);
		expect(isBenignResponseCollision('active response timeout')).toBe(false);
	});
});
