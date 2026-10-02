import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { createHmac } from 'node:crypto';
import {
	ensureBindingsImported,
	isMultiUserMode,
	safeEqualStr,
	syntheticEnvBinding,
	readEnvTrimmed,
	type Binding
} from '$lib/server/bindings.server';
import { isAuthLockedOut, recordAuthFailure } from '$lib/server/rateLimit.server';
import { sessionSecret } from '$lib/server/sessionSecret.server';

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

/**
 * Minimum voice-key length accepted when a key is SET (setup save, owner user admin).
 * Existing shorter keys keep working — this only gates new/rotated keys. The in-app
 * "Generate key" buttons produce 48 hex chars.
 */
export const MIN_VOICE_KEY_LENGTH = 24;

export function isStrongVoiceKey(key: string): boolean {
	const k = key.trim();
	if (k.length < MIN_VOICE_KEY_LENGTH) return false;
	const counts = new Map<string, number>();
	for (const ch of k) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	if (counts.size < 8) return false;
	// A key that is one shorter unit repeated ("password1234password1234") is only as
	// strong as that unit.
	for (let unit = 1; unit <= k.length / 2; unit++) {
		if (k.length % unit === 0 && k.slice(0, unit).repeat(k.length / unit) === k) return false;
	}
	// Shannon estimate over the key's own character distribution — catches long but
	// low-variety keys. 64 bits keeps every realistic random 24+ char key (24 random hex
	// chars score ~80–90) while rejecting padded patterns.
	let bits = 0;
	for (const n of counts.values()) {
		const p = n / k.length;
		bits -= n * Math.log2(p);
	}
	return bits >= 64;
}

/**
 * Derived session token — cookie never stores the raw voice key. Keyed with the server's
 * session secret (sessionSecret.server.ts), so it can't be computed from a guessed voice
 * key: cookie guesses are 256-bit blind guesses and need no lockout.
 */
export function derivedSessionToken(voiceKey: string): string {
	return createHmac('sha256', sessionSecret())
		.update('hermes-voice-session-v2\0')
		.update(voiceKey)
		.digest('hex');
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

	if (isCrossSiteSubresource(event)) return null;
	return nonEmptyString(event.url.searchParams.get('k'));
}

/**
 * A cross-site (or sibling-subdomain) `<img>`/`<script>`/fetch pointed at us. Any page can make a
 * visitor's browser send `?k=…` this way, so such a key is ignored outright — neither
 * evaluated nor counted — instead of letting a third-party page burn that visitor's
 * failed-key budget. Top-level navigations (a `?k=` link clicked in mail/chat) still work.
 */
export function isCrossSiteSubresource(event: RequestEvent): boolean {
	const h = event.request.headers;
	const site = h.get('sec-fetch-site');
	if (site !== 'cross-site' && site !== 'same-site') return false;
	const dest = h.get('sec-fetch-dest');
	return dest !== null && dest !== 'document';
}

/**
 * During bootstrap a script may send SETUP_TOKEN as `Authorization: Bearer`, which the
 * Lounge also reads as a voice key — don't count the setup token as a failed voice key.
 */
function isLiveSetupToken(raw: string): boolean {
	if (readEnvTrimmed('SETUP_COMPLETE') === '1') return false;
	const token = readEnvTrimmed('SETUP_TOKEN');
	return token !== null && safeEqualStr(token, raw);
}

/**
 * Resolve authenticated Voice user → binding.
 * MULTI_USER≠1: synthetic owner from env (process.env-first).
 * MULTI_USER=1: bindings file ONLY (lazy import if empty); never env synthetic.
 */
export async function resolveBinding(event: RequestEvent, body?: unknown): Promise<Binding | null> {
	const raw = extractVoiceKey(event, body);
	const cookie = readLoungeCookie(event);
	// Anonymous request — nothing to verify, nothing to count.
	if (!raw && !cookie) return null;

	// Raw key first (it may be a deliberate switch to another binding), then the session
	// cookie. Raw keys have a failed-attempt budget: once exhausted for this address they
	// answer "no" WITHOUT being evaluated (no oracle). Cookies are unaffected by it, so a
	// raw-key lockout (even one forced by a third-party page) never signs anyone out.
	if (raw && !isAuthLockedOut(event, 'key')) {
		const fromKey = await matchCredential(raw, null);
		// Store unavailable (no key configured yet / bindings unreadable): fail closed, but
		// it isn't the caller's fault — don't count it.
		if (fromKey === 'unavailable') return null;
		if (fromKey) return fromKey;
		if (!isLiveSetupToken(raw)) recordAuthFailure(event, raw, 'key');
	}

	if (cookie) {
		// No lockout on this path: the cookie is HMAC(serverSecret, voiceKey), so a guessed
		// cookie is a blind 256-bit guess, not a voice-key guess (see derivedSessionToken).
		// That's what lets a signed-in browser keep working whatever else its IP is doing.
		const fromCookie = await matchCredential(null, cookie);
		if (fromCookie === 'unavailable') return null;
		if (fromCookie) return fromCookie;
		// Stale/invalid (e.g. after key rotation or a secret reset) — drop it once.
		clearSessionCookie(event.cookies);
	}
	return null;
}

async function matchCredential(
	raw: string | null,
	cookie: string | null
): Promise<Binding | null | 'unavailable'> {
	if (!isMultiUserMode()) {
		const synthetic = syntheticEnvBinding();
		if (!synthetic) return 'unavailable';
		if (raw) {
			return safeEqualStr(synthetic.voiceKey, raw) ? synthetic : null;
		}
		if (!cookie) return null;
		const expected = derivedSessionToken(synthetic.voiceKey);
		return safeEqualStr(expected, cookie) ? synthetic : null;
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) return 'unavailable';

	const enabled = imported.file.users.filter((u) => u.enabled);

	if (raw) {
		for (const u of enabled) {
			if (safeEqualStr(u.voiceKey, raw)) return u;
		}
		return null;
	}

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
export async function requireVoiceKey(event: RequestEvent, body?: unknown): Promise<Binding> {
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
