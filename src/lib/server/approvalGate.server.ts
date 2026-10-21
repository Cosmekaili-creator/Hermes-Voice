import { createHash, createHmac, randomBytes } from 'node:crypto';
import { looksLikeSideEffect } from '$lib/voice/approvals';
import { safeEqualStr } from '$lib/server/cryptoEqual.server';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { sessionSecret } from '$lib/server/sessionSecret.server';
import type { Binding } from '$lib/server/bindings.server';

/**
 * Server-side backstop for action approvals. The Lounge already asks the human before it
 * dispatches a side-effecting brief, but that check lives in the browser and can miss a
 * request (its side-effect detection) or be switched off (the toggle). For the roles the
 * policy covers, `/api/tasks/dispatch` and `/api/hermes` therefore refuse such a brief
 * until the request carries a short-lived, single-use token that the server minted for
 * that exact brief and binding. This catches a well-behaved client in those cases, i.e. a
 * prompt-injected or forgetful voice model. It is NOT a defence against a hostile scripted
 * client holding the voice key: a 409 without a token hands out a valid one.
 *
 * `VOICE_APPROVALS_ENFORCE`:
 *  - `users` (default): enforce for `role !== 'owner'`. Single-user mode is a synthetic
 *    owner binding, so the default changes nothing there.
 *  - `all`: also the owner.
 *  - `off`: client-only behaviour (what shipped before this gate).
 */
export type ApprovalPolicy = 'users' | 'all' | 'off';

export const APPROVAL_TOKEN_TTL_MS = 5 * 60_000;
/** Hard ceiling on remembered (burned) nonces — the store must never grow without bound. */
export const MAX_USED_NONCES = 5_000;

export function approvalPolicy(): ApprovalPolicy {
	const raw = readEnvTrimmed('VOICE_APPROVALS_ENFORCE')?.toLowerCase();
	if (raw === 'all' || raw === 'off') return raw;
	return 'users';
}

export function approvalsMandatoryFor(binding: Pick<Binding, 'role'>): boolean {
	const policy = approvalPolicy();
	if (policy === 'off') return false;
	if (policy === 'all') return true;
	return binding.role !== 'owner';
}

export function needsServerApproval(
	binding: Pick<Binding, 'role'>,
	request: string,
	modelFlag: boolean
): boolean {
	return approvalsMandatoryFor(binding) && (modelFlag || looksLikeSideEffect(request));
}

function sha256Hex(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function macFor(bindingId: string, request: string, exp: number, nonce: string): string {
	return createHmac('sha256', sessionSecret())
		.update(`hv-approval-v1\0${bindingId}\0${sha256Hex(request)}\0${exp}\0${nonce}`)
		.digest('base64url');
}

export function mintApprovalToken(
	bindingId: string,
	request: string,
	now: number = Date.now()
): { token: string; expiresAt: number } {
	const expiresAt = now + APPROVAL_TOKEN_TTL_MS;
	const nonce = randomBytes(12).toString('base64url');
	return {
		token: `v1.${expiresAt}.${nonce}.${macFor(bindingId, request, expiresAt, nonce)}`,
		expiresAt
	};
}

/** nonce → expiry. Insertion-ordered, so the oldest entries are evicted first. */
const burnedNonces = new Map<string, number>();

function burnNonce(nonce: string, exp: number, now: number): void {
	if (burnedNonces.size >= MAX_USED_NONCES) {
		for (const [n, e] of burnedNonces) {
			if (e <= now) burnedNonces.delete(n);
		}
		// Still full of live nonces: drop the oldest. Replaying an evicted token would take
		// MAX_USED_NONCES newer approvals inside one 5-minute window.
		for (const n of burnedNonces.keys()) {
			if (burnedNonces.size < MAX_USED_NONCES) break;
			burnedNonces.delete(n);
		}
	}
	burnedNonces.set(nonce, exp);
}

/**
 * `ok` consumes the token (the nonce is burned here, before the caller persists anything,
 * so concurrent double-submits cannot both pass). `expired` is retryable with a fresh
 * token; `invalid` (bad signature, other brief / binding, reused) is not.
 */
export function verifyApprovalToken(
	token: string,
	bindingId: string,
	request: string,
	now: number = Date.now()
): 'ok' | 'expired' | 'invalid' {
	const parts = token.split('.');
	if (parts.length !== 4 || parts[0] !== 'v1') return 'invalid';
	const [, expRaw, nonce, mac] = parts as [string, string, string, string];
	if (!/^\d{1,15}$/.test(expRaw) || !nonce || !mac) return 'invalid';
	const exp = Number(expRaw);
	if (!safeEqualStr(mac, macFor(bindingId, request, exp, nonce))) return 'invalid';
	if (exp <= now) return 'expired';
	if (burnedNonces.has(nonce)) return 'invalid';
	burnNonce(nonce, exp, now);
	return 'ok';
}

export type ApprovalCheck =
	| { ok: true }
	| {
			ok: false;
			status: 409;
			payload: {
				ok: false;
				code: 'approval_required' | 'approval_invalid';
				approval?: { token: string; expiresAt: number };
			};
	  };

/**
 * Gate for a brief about to be dispatched. `body` is the raw request JSON:
 * `requires_approval` (the realtime model's own flag) and `approval_token`.
 */
export function checkApproval(
	binding: Pick<Binding, 'id' | 'role'>,
	request: string,
	body: unknown
): ApprovalCheck {
	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	if (!needsServerApproval(binding, request, b.requires_approval === true)) return { ok: true };

	const token = typeof b.approval_token === 'string' ? b.approval_token : '';
	if (token) {
		const verdict = verifyApprovalToken(token, binding.id, request);
		if (verdict === 'ok') return { ok: true };
		if (verdict === 'invalid') {
			return { ok: false, status: 409, payload: { ok: false, code: 'approval_invalid' } };
		}
		// expired → fall through and hand out a fresh token
	}
	return {
		ok: false,
		status: 409,
		payload: {
			ok: false,
			code: 'approval_required',
			approval: mintApprovalToken(binding.id, request)
		}
	};
}
