import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { createHmac } from 'node:crypto';
import {
	ensureBindingsImported,
	isMultiUserMode,
	safeEqualStr,
	syntheticEnvBinding,
	type Binding
} from '$lib/server/bindings.server';

/** `__Host-` on HTTPS (Secure + Path=/ + no Domain). Plain name on local HTTP. */
export const VOICE_COOKIE_HOST = '__Host-hv';
export const VOICE_COOKIE_DEV = 'hv';

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function cookieName(secure: boolean): string {
	return secure ? VOICE_COOKIE_HOST : VOICE_COOKIE_DEV;
}

function readLoungeCookie(event: RequestEvent): string | null {
	const secure = event.url.protocol === 'https:';
	return (
		nonEmptyString(event.cookies.get(cookieName(secure))) ??
		nonEmptyString(event.cookies.get(VOICE_COOKIE_HOST)) ??
		nonEmptyString(event.cookies.get(VOICE_COOKIE_DEV))
	);
}

/** Derived session token — cookie never stores the raw voice key. */
export function derivedSessionToken(voiceKey: string): string {
	return createHmac('sha256', voiceKey).update('hermes-voice-session-v1').digest('hex');
}

/**
 * Extract raw voice key with hard precedence:
 * JSON body.k → X-Hermes-Voice-Key → Authorization Bearer → optional ?k=
 * Never log the raw key.
 */
export function extractVoiceKey(event: RequestEvent, body?: unknown): string | null {
	if (body && typeof body === 'object' && body !== null && 'k' in body) {
		const fromBody = nonEmptyString((body as { k?: unknown }).k);
		if (fromBody) return fromBody;
	}

	const headerKey = nonEmptyString(event.request.headers.get('x-hermes-voice-key'));
	if (headerKey) return headerKey;

	const auth = event.request.headers.get('authorization');
	if (auth) {
		const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
		const bearer = match ? nonEmptyString(match[1]) : null;
		if (bearer) return bearer;
	}

	return nonEmptyString(event.url.searchParams.get('k'));
}

/**
 * Resolve authenticated Voice user → binding.
 * MULTI_USER≠1: synthetic owner from env (process.env-first).
 * MULTI_USER=1: bindings file ONLY (lazy import if empty); never env synthetic.
 */
export async function resolveBinding(
	event: RequestEvent,
	body?: unknown
): Promise<Binding | null> {
	const raw = extractVoiceKey(event, body);

	if (!isMultiUserMode()) {
		const synthetic = syntheticEnvBinding();
		if (!synthetic) return null;
		if (raw) {
			return safeEqualStr(synthetic.voiceKey, raw) ? synthetic : null;
		}
		const cookie = readLoungeCookie(event);
		if (!cookie) return null;
		const expected = derivedSessionToken(synthetic.voiceKey);
		return safeEqualStr(expected, cookie) ? synthetic : null;
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) return null;

	const enabled = imported.file.users.filter((u) => u.enabled);

	if (raw) {
		for (const u of enabled) {
			if (safeEqualStr(u.voiceKey, raw)) return u;
		}
		return null;
	}

	const cookie = readLoungeCookie(event);
	if (!cookie) return null;
	for (const u of enabled) {
		const token = derivedSessionToken(u.voiceKey);
		if (safeEqualStr(token, cookie)) return u;
	}
	return null;
}

/** Page or API: raw key OR post-gate session cookie. */
export async function isAuthenticated(event: RequestEvent, body?: unknown): Promise<boolean> {
	return (await resolveBinding(event, body)) !== null;
}

/** For API routes: throw 401 if invalid; return resolved binding. */
export async function requireVoiceKey(
	event: RequestEvent,
	body?: unknown
): Promise<Binding> {
	const binding = await resolveBinding(event, body);
	if (!binding) {
		error(401, 'Unauthorized');
	}
	return binding;
}

/** Owner-only mutators / admin pages. */
export async function requireOwner(event: RequestEvent, body?: unknown): Promise<Binding> {
	const binding = await requireVoiceKey(event, body);
	if (binding.role !== 'owner') {
		error(403, 'Forbidden');
	}
	return binding;
}

/**
 * After a valid ?k= gate: set HttpOnly Secure SameSite=Lax cookie.
 * Lax (not Strict) so standalone PWA / home-screen launches still send it.
 * Max-Age ~400 days; rotating the voice key invalidates the derived token immediately.
 */
export function grantSessionCookie(event: RequestEvent, voiceKey: string): void {
	const token = derivedSessionToken(voiceKey);
	const secure = event.url.protocol === 'https:';
	const name = cookieName(secure);

	event.cookies.set(name, token, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 400
	});
}

/** Clear both cookie names (logout / key rotation helper). */
export function clearSessionCookie(cookies: Cookies): void {
	for (const name of [VOICE_COOKIE_HOST, VOICE_COOKIE_DEV]) {
		cookies.delete(name, { path: '/' });
	}
}

/** True if this principal may access owner pages (single-user: any auth = owner). */
export function isOwnerPrincipal(binding: Binding | null): boolean {
	if (!binding) return false;
	if (!isMultiUserMode()) return true;
	return binding.role === 'owner';
}
