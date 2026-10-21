import { afterEach, describe, expect, it } from 'vitest';
import {
	APPROVAL_TOKEN_TTL_MS,
	approvalPolicy,
	approvalsMandatoryFor,
	checkApproval,
	MAX_USED_NONCES,
	mintApprovalToken,
	needsServerApproval,
	verifyApprovalToken
} from './approvalGate.server';

const OWNER = { id: 'owner', role: 'owner' as const };
const USER = { id: 'alice', role: 'user' as const };
const SEND = 'Send an email to Bob saying the meeting moved to 3pm';
const LOOKUP = 'What did Marc send me yesterday?';

afterEach(() => {
	delete process.env.VOICE_APPROVALS_ENFORCE;
});

describe('approval policy', () => {
	it('defaults to enforcing for non-owners only', () => {
		expect(approvalPolicy()).toBe('users');
		expect(approvalsMandatoryFor(USER)).toBe(true);
		expect(approvalsMandatoryFor(OWNER)).toBe(false);
	});

	it('all also covers the owner; off covers nobody; junk falls back to users', () => {
		process.env.VOICE_APPROVALS_ENFORCE = 'all';
		expect(approvalsMandatoryFor(OWNER)).toBe(true);
		expect(approvalsMandatoryFor(USER)).toBe(true);
		process.env.VOICE_APPROVALS_ENFORCE = 'off';
		expect(approvalsMandatoryFor(OWNER)).toBe(false);
		expect(approvalsMandatoryFor(USER)).toBe(false);
		process.env.VOICE_APPROVALS_ENFORCE = 'banana';
		expect(approvalPolicy()).toBe('users');
	});

	it('needs approval only for flagged or side-effect briefs', () => {
		expect(needsServerApproval(USER, SEND, false)).toBe(true);
		expect(needsServerApproval(USER, LOOKUP, false)).toBe(false);
		expect(needsServerApproval(USER, LOOKUP, true)).toBe(true);
		expect(needsServerApproval(OWNER, SEND, true)).toBe(false);
	});
});

describe('approval tokens', () => {
	it('mints v1 tokens that verify once for the same binding and brief', () => {
		const { token, expiresAt } = mintApprovalToken('alice', SEND);
		expect(token.startsWith('v1.')).toBe(true);
		expect(expiresAt).toBeGreaterThan(Date.now());
		expect(verifyApprovalToken(token, 'alice', SEND)).toBe('ok');
		expect(verifyApprovalToken(token, 'alice', SEND)).toBe('invalid');
	});

	it('rejects a token for another brief or another binding (and does not burn it)', () => {
		const { token } = mintApprovalToken('alice', SEND);
		expect(verifyApprovalToken(token, 'alice', `${SEND} and cc Carol`)).toBe('invalid');
		expect(verifyApprovalToken(token, 'bob', SEND)).toBe('invalid');
		expect(verifyApprovalToken(token, 'alice', SEND)).toBe('ok');
	});

	it('rejects tampered and malformed tokens', () => {
		const { token } = mintApprovalToken('alice', SEND);
		const parts = token.split('.');
		const later = `${parts[0]}.${Number(parts[1]) + 60_000}.${parts[2]}.${parts[3]}`;
		expect(verifyApprovalToken(later, 'alice', SEND)).toBe('invalid');
		expect(verifyApprovalToken(`${token}x`, 'alice', SEND)).toBe('invalid');
		for (const junk of ['', 'v1', 'v1.a.b.c', 'v2.1.2.3', 'v1.1.2.3.4']) {
			expect(verifyApprovalToken(junk, 'alice', SEND)).toBe('invalid');
		}
	});

	it('reports a correctly signed but stale token as expired', () => {
		const t0 = Date.now() - 10 * APPROVAL_TOKEN_TTL_MS;
		const { token } = mintApprovalToken('alice', SEND, t0);
		expect(verifyApprovalToken(token, 'alice', SEND)).toBe('expired');
	});

	it('burns the nonce so only one of two concurrent submits passes', () => {
		const { token } = mintApprovalToken('alice', SEND);
		const results = [
			verifyApprovalToken(token, 'alice', SEND),
			verifyApprovalToken(token, 'alice', SEND)
		];
		expect(results.filter((r) => r === 'ok')).toHaveLength(1);
	});

	it('stays bounded under a flood of approvals', () => {
		for (let i = 0; i < MAX_USED_NONCES + 50; i++) {
			const { token } = mintApprovalToken('alice', `Send message ${i}`);
			expect(verifyApprovalToken(token, 'alice', `Send message ${i}`)).toBe('ok');
		}
		// Newest tokens are still burned after eviction of the oldest.
		const { token } = mintApprovalToken('alice', 'Send the last one');
		expect(verifyApprovalToken(token, 'alice', 'Send the last one')).toBe('ok');
		expect(verifyApprovalToken(token, 'alice', 'Send the last one')).toBe('invalid');
	});
});

describe('checkApproval', () => {
	it('passes owners and lookups untouched', () => {
		expect(checkApproval(OWNER, SEND, {})).toEqual({ ok: true });
		expect(checkApproval(USER, LOOKUP, {})).toEqual({ ok: true });
	});

	it('answers a missing token with approval_required plus a fresh token', () => {
		const res = checkApproval(USER, SEND, {});
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.status).toBe(409);
		expect(res.payload.code).toBe('approval_required');
		expect(res.payload.approval?.token).toBeTruthy();
		expect(res.payload.approval?.expiresAt).toBeGreaterThan(Date.now());
	});

	it('the model flag alone triggers it', () => {
		const res = checkApproval(USER, LOOKUP, { requires_approval: true });
		expect(res.ok).toBe(false);
	});

	it('accepts the minted token once, then answers approval_invalid without a new token', () => {
		const first = checkApproval(USER, SEND, {});
		if (first.ok) throw new Error('expected 409');
		const body = { approval_token: first.payload.approval!.token };
		expect(checkApproval(USER, SEND, body)).toEqual({ ok: true });
		const again = checkApproval(USER, SEND, body);
		expect(again).toEqual({
			ok: false,
			status: 409,
			payload: { ok: false, code: 'approval_invalid' }
		});
	});

	it('hands out a fresh token for an expired one', () => {
		const stale = mintApprovalToken(USER.id, SEND, Date.now() - 10 * APPROVAL_TOKEN_TTL_MS);
		const res = checkApproval(USER, SEND, { approval_token: stale.token });
		if (res.ok) throw new Error('expected 409');
		expect(res.payload.code).toBe('approval_required');
		expect(res.payload.approval?.token).not.toBe(stale.token);
	});
});
