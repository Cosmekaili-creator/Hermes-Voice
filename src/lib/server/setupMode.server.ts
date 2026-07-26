import { env } from '$env/dynamic/private';
import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { createHmac } from 'node:crypto';
import { isAuthenticated, requireOwner, requireVoiceKey, resolveBinding } from '$lib/server/auth';
import { isMultiUserMode } from '$lib/server/bindings.server';
import { safeEqualStr } from '$lib/server/cryptoEqual.server';

/** Setup-only cookie — never grants Lounge session (`hv` / `__Host-hv`). */
export const SETUP_COOKIE_HOST = '__Host-hv_setup';
export const SETUP_COOKIE_DEV = 'hv_setup';

export type SetupMode = 'bootstrap' | 'ops_locked' | 'complete';

/**
 * `$env/dynamic/private` is a filtered snapshot at Server.init under adapter-node.
 * After bootstrap save we must hard-lock without waiting for restart — these flags
 * take precedence over the snapshot / process.env for setup-mode decisions.
 */
let runtimeComplete = false;
let runtimeSetupTokenRevoked = false;

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function cookieName(secure: boolean): string {
	return secure ? SETUP_COOKIE_HOST : SETUP_COOKIE_DEV;
}

function readEnvTrimmed(key: string): string | null {
	const fromProcess = process.env[key]?.trim();
	if (fromProcess) return fromProcess;
	const fromSnapshot = env[key]?.trim();
	return fromSnapshot || null;
}

/** Effective SETUP_TOKEN for auth — null after bootstrap revoke or when complete. */
function effectiveSetupToken(): string | null {
	if (runtimeComplete || runtimeSetupTokenRevoked) return null;
	if (readEnvTrimmed('SETUP_COMPLETE') === '1') return null;
	return readEnvTrimmed('SETUP_TOKEN');
}

/** SETUP_COMPLETE=1 hard-locks bootstrap; SETUP_TOKEN is ignored. */
export function isSetupComplete(): boolean {
	if (runtimeComplete) return true;
	return readEnvTrimmed('SETUP_COMPLETE') === '1';
}

export function getSetupMode(): SetupMode {
	if (isSetupComplete()) return 'complete';
	if (effectiveSetupToken()) return 'bootstrap';
	return 'ops_locked';
}

/** Derived setup session — cookie never stores raw SETUP_TOKEN. */
export function derivedSetupSessionToken(): string | null {
	const key = effectiveSetupToken();
	if (!key) return null;
	return createHmac('sha256', key).update('hermes-voice-setup-v1').digest('hex');
}

export function extractSetupToken(event: RequestEvent, body?: unknown): string | null {
	if (body && typeof body === 'object' && body !== null && 'token' in body) {
		const fromBody = nonEmptyString((body as { token?: unknown }).token);
		if (fromBody) return fromBody;
	}

	const headerKey = nonEmptyString(event.request.headers.get('x-hermes-setup-token'));
	if (headerKey) return headerKey;

	const auth = event.request.headers.get('authorization');
	if (auth) {
		const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
		const bearer = match ? nonEmptyString(match[1]) : null;
		if (bearer) return bearer;
	}

	return nonEmptyString(event.url.searchParams.get('token'));
}

/** True if provided matches effective SETUP_TOKEN. Fail closed if complete or token missing. */
export function isValidSetupToken(provided: string | null): boolean {
	if (isSetupComplete()) return false;
	const expected = effectiveSetupToken();
	if (!expected || !provided) return false;
	return safeEqualStr(expected, provided);
}

export function isValidSetupCookie(event: RequestEvent): boolean {
	const expected = derivedSetupSessionToken();
	if (!expected) return false;
	const secure = event.url.protocol === 'https:';
	const got =
		event.cookies.get(cookieName(secure)) ??
		event.cookies.get(SETUP_COOKIE_HOST) ??
		event.cookies.get(SETUP_COOKIE_DEV);
	if (!got) return false;
	return safeEqualStr(expected, got);
}

/** Bootstrap unlock: raw SETUP_TOKEN or setup cookie. Never unlocks Lounge. */
export function isSetupUnlocked(event: RequestEvent, body?: unknown): boolean {
	if (getSetupMode() !== 'bootstrap') return false;
	if (isValidSetupToken(extractSetupToken(event, body))) return true;
	return isValidSetupCookie(event);
}

export function grantSetupCookie(event: RequestEvent): void {
	const token = derivedSetupSessionToken();
	if (!token) return;

	const secure = event.url.protocol === 'https:';
	const name = cookieName(secure);

	event.cookies.set(name, token, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: 60 * 60 * 8
	});
}

export function clearSetupCookie(cookies: Cookies): void {
	for (const name of [SETUP_COOKIE_HOST, SETUP_COOKIE_DEV]) {
		cookies.delete(name, { path: '/' });
	}
}

/**
 * Mode A: setup cookie/token. Mode D: owner session (any key in single-user).
 * Mode B mutators: 403. Mode C anonymous: 401 via requireVoiceKey.
 * Multi-user complete: owner only. After bootstrap revoke, SETUP_TOKEN path is dead.
 */
export async function requireSetupOrOwner(event: RequestEvent, body?: unknown): Promise<void> {
	const mode = getSetupMode();
	if (mode === 'bootstrap') {
		if (isSetupUnlocked(event, body)) return;
		error(403, 'Forbidden');
	}
	if (mode === 'complete') {
		if (isMultiUserMode()) {
			await requireOwner(event, body);
		} else {
			await requireVoiceKey(event, body);
		}
		return;
	}
	error(403, 'Forbidden');
}

/** Page load helpers — never expose secrets. */
export async function setupPageFlags(event: RequestEvent): Promise<{
	mode: SetupMode;
	unlocked: boolean;
	rotation: boolean;
}> {
	const mode = getSetupMode();
	if (mode === 'bootstrap') {
		return { mode, unlocked: isSetupUnlocked(event), rotation: false };
	}
	if (mode === 'complete') {
		if (isMultiUserMode()) {
			const binding = await resolveBinding(event);
			const owner = binding?.role === 'owner';
			return { mode, unlocked: Boolean(owner), rotation: Boolean(owner) };
		}
		const owner = await isAuthenticated(event);
		return { mode, unlocked: owner, rotation: owner };
	}
	return { mode, unlocked: false, rotation: false };
}

/**
 * After successful bootstrap save: disk already cleared; sync process env and
 * runtime flags so SETUP_TOKEN cannot unlock further mutators before restart.
 */
export function revokeBootstrapInProcess(): void {
	process.env.SETUP_COMPLETE = '1';
	delete process.env.SETUP_TOKEN;
	runtimeComplete = true;
	runtimeSetupTokenRevoked = true;
}
