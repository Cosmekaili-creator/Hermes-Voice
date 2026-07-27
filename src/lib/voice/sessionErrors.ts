/** /api/session failure classification — pure so it can be unit tested (node project). */
import type { VoiceErrorCode } from '../i18n/types';

/** Map a non-2xx /api/session status onto a specific i18n error key. */
export function sessionErrorForStatus(status: number): VoiceErrorCode {
	if (status === 401) return 'error.sessionUnauthorized';
	if (status === 403) return 'error.sessionForbidden';
	if (status === 429) return 'error.sessionRateLimited';
	if (status >= 500) return 'error.sessionUnavailable';
	return 'error.sessionRequestFailed';
}

/** True only when the browser positively reports offline. Never gates behaviour. */
export function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** fetch() threw (DNS/TCP/CORS/offline) — no HTTP response at all. */
export function transportErrorCode(): VoiceErrorCode {
	return isOffline() ? 'error.offline' : 'error.networkFailed';
}
