import { env } from '$env/dynamic/private';
import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** `__Host-` on HTTPS (Secure + Path=/ + no Domain). Plain name on local HTTP. */
export const VOICE_COOKIE_HOST = '__Host-hv';
export const VOICE_COOKIE_DEV = 'hv';

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function safeEqualStr(a: string, b: string): boolean {
	const ba = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	if (ba.length !== bb.length) return false;
	try {
		return timingSafeEqual(ba, bb);
	} catch {
		return false;
	}
}

/** Derived session token — cookie never stores the raw VOICE_URL_KEY. */
export function derivedSessionToken(): string | null {
	const key = env.VOICE_URL_KEY;
	if (!key) return null;
	return createHmac('sha256', key).update('hermes-voice-session-v1').digest('hex');
}

function cookieName(secure: boolean): string {
	return secure ? VOICE_COOKIE_HOST : VOICE_COOKIE_DEV;
}

/**
 * Extract raw VOICE_URL_KEY with hard precedence:
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

/** True if provided matches env.VOICE_URL_KEY (fail closed if env missing). Never log k. */
export function isValidVoiceKey(provided: string | null): boolean {
	const expected = env.VOICE_URL_KEY;
	if (!expected || !provided) return false;
	return safeEqualStr(expected, provided);
}

export function isValidSessionCookie(event: RequestEvent): boolean {
	const expected = derivedSessionToken();
	if (!expected) return false;
	const secure = event.url.protocol === 'https:';
	const got =
		event.cookies.get(cookieName(secure)) ??
		// Accept either name if a prior visit flipped protocols (dev → preview)
		event.cookies.get(VOICE_COOKIE_HOST) ??
		event.cookies.get(VOICE_COOKIE_DEV);
	if (!got) return false;
	return safeEqualStr(expected, got);
}

/** Page or API: raw key OR post-gate session cookie. */
export function isAuthenticated(event: RequestEvent, body?: unknown): boolean {
	if (isValidVoiceKey(extractVoiceKey(event, body))) return true;
	return isValidSessionCookie(event);
}

/** For API routes: throw error(401, 'Unauthorized') if invalid. */
export function requireVoiceKey(event: RequestEvent, body?: unknown): void {
	if (!isAuthenticated(event, body)) {
		error(401, 'Unauthorized');
	}
}

/**
 * After a valid ?k= gate: set HttpOnly Secure SameSite=Lax cookie.
 * Lax (not Strict) so standalone PWA / home-screen launches still send it.
 * Max-Age ~400 days; rotating VOICE_URL_KEY invalidates the derived token immediately.
 */
export function grantSessionCookie(event: RequestEvent): void {
	const token = derivedSessionToken();
	if (!token) return;

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
