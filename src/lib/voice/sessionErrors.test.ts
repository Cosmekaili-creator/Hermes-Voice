import { describe, expect, it } from 'vitest';
import { isOffline, sessionErrorForStatus, transportErrorCode } from './sessionErrors';

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
