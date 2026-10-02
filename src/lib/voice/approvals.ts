/**
 * Action approvals — a human confirmation step before Hermes does anything with a
 * real-world effect (send, book, buy, delete, change a calendar...).
 *
 * Two independent triggers, either is enough:
 *  1. the realtime model flags the task (`requires_approval: true` on start_task), and
 *  2. a client-side backstop that recognises side-effect verbs in the brief itself, so a
 *     model that forgets (or is prompt-injected into skipping) the flag still can't
 *     dispatch "send an email to…" without the user seeing it first.
 *
 * Pure module (no Svelte state) so the detection rules are unit-testable.
 */

/**
 * Imperative side-effect verbs at a clause start ("Send…", "…and add it to…", "please
 * book…"). Deliberately clause-anchored: "what did Marc send me?" is a lookup, not an action.
 */
const SIDE_EFFECT_RE =
	/(?:^|[.;:!?\n]\s*|\b(?:and|then|please|also)\s+)(?:send|reply|respond|forward|email|e-mail|text|message|book|reserve|buy|purchase|order|pay|transfer|donate|delete|remove|erase|cancel|unsubscribe|archive|post|publish|tweet|share|schedule|reschedule|invite|create|add|move|accept|decline|update|change|set up|sign up|register|submit|run|execute|restart|shut down|deploy|install)\b/i;

export function looksLikeSideEffect(request: string): boolean {
	return SIDE_EFFECT_RE.test(request.trim());
}

export function needsApproval(request: string, modelFlag: boolean, enabled: boolean): boolean {
	if (!enabled) return false;
	return modelFlag || looksLikeSideEffect(request);
}

export type PendingApproval = {
	id: string;
	callId: string;
	summary: string;
	request: string;
	title?: string;
	createdAt: number;
};

/** Short one-line summary for the card header: model-provided, else the brief's first clause. */
export function approvalSummary(request: string, modelSummary?: string): string {
	const fromModel = modelSummary?.trim();
	if (fromModel) return fromModel.length > 140 ? `${fromModel.slice(0, 139)}…` : fromModel;
	const first = request.trim().split(/(?<=[.!?])\s/)[0] ?? request;
	return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

export const APPROVALS_STORAGE_KEY = 'hermes-voice.confirmActions';

export function readApprovalsEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(APPROVALS_STORAGE_KEY) !== '0';
	} catch {
		return true;
	}
}

export function writeApprovalsEnabled(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(APPROVALS_STORAGE_KEY, enabled ? '1' : '0');
	} catch {
		/* ignore */
	}
}
