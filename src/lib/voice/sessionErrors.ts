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

/** Provider replies this when we send response.cancel with nothing in flight. */
export function isBenignCancelError(message: string): boolean {
	const m = message.toLowerCase();
	return m.includes('no active response') || m.includes('cancellation failed');
}

/**
 * F2: parallel tool calls (start_task/clear_task_queue can fire several in one turn) each
 * funnel through completeToolCall(), which only calls respond() once — but a race is still
 * possible if two separate call paths each think they're the last outstanding call. When
 * that happens the provider replies with some phrasing of "already has an active response"
 * rather than the isBenignCancelError() message above — this is the second benign case, and
 * must not tear down the session (console.warn + return; the existing think-timer remains
 * the real backstop if a turn genuinely stalls).
 */
export function isBenignResponseCollision(message: string, code?: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes('already has an active response') ||
		code === 'conversation_already_has_active_response'
	);
}
