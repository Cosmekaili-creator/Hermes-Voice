import { error, type RequestEvent } from '@sveltejs/kit';
import { isIP } from 'node:net';

type Bucket = {
	count: number;
	resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Hard ceiling on tracked buckets — the store must never grow without bound. */
export const MAX_BUCKETS = 10_000;

function stripMapped(ip: string): string {
	return ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
}

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return null;
		n = n * 256 + o;
	}
	return n;
}

/** `a.b.c.d` or `a.b.c.d/nn` (IPv4), or an exact IPv6 address. */
function matchesTrustedEntry(ip: string, entry: string): boolean {
	const [base, bitsRaw] = entry.split('/');
	if (!base) return false;
	if (isIP(base) === 6) return bitsRaw === undefined && base.toLowerCase() === ip.toLowerCase();
	const target = ipv4ToInt(ip);
	const net = ipv4ToInt(base);
	if (target === null || net === null) return false;
	const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
	if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
	if (bits === 0) return true;
	const size = 2 ** (32 - bits);
	return Math.floor(target / size) === Math.floor(net / size);
}

/**
 * A peer whose `X-Forwarded-For` we believe: loopback always (the documented
 * nginx/Caddy-on-the-same-host deployment), plus anything listed in
 * `TRUSTED_PROXY_IPS` (comma-separated IPv4 / IPv4 CIDR / exact IPv6) — e.g. a Docker
 * bridge gateway. Private ranges are NOT trusted by default: a LAN or port-forwarded peer
 * that isn't a header-appending proxy would otherwise pick its own bucket.
 */
function isTrustedProxyPeer(ip: string): boolean {
	const host = stripMapped(ip);
	if (host === '::1') return true;
	if (isIP(host) === 4 && host.startsWith('127.')) return true;
	const extra = process.env.TRUSTED_PROXY_IPS?.trim();
	if (!extra) return false;
	return extra
		.split(',')
		.map((e) => e.trim())
		.filter(Boolean)
		.some((entry) => matchesTrustedEntry(host, entry));
}

function socketAddress(event: RequestEvent): string | null {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}

/**
 * Client IP for rate limiting — never trusts a client-controlled header.
 *
 * - `ADDRESS_HEADER` set: adapter-node already resolved the address from the configured
 *   header (with `XFF_DEPTH`) — use it verbatim.
 * - Peer is not a trusted proxy (see isTrustedProxyPeer): the socket address is
 *   authoritative; any `X-Forwarded-For` / `X-Real-IP` the client sent is ignored.
 * - Peer is a trusted proxy: take the RIGHT-most `X-Forwarded-For` entry — the one the
 *   proxy itself appended (nginx `$proxy_add_x_forwarded_for` keeps the client's own
 *   spoofable entries on the left). No XFF at all: the peer address (all clients then
 *   share one bucket — configure the proxy to send XFF).
 */
export function clientIp(event: RequestEvent): string {
	const peer = socketAddress(event);
	if (process.env.ADDRESS_HEADER?.trim() && peer) return peer;
	if (peer && !isTrustedProxyPeer(peer)) return peer;

	const xf = event.request.headers.get('x-forwarded-for');
	if (xf) {
		const parts = xf
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean);
		const last = parts[parts.length - 1];
		if (last) return last;
	}
	return peer ?? 'unknown';
}

function expandIpv6(ip: string): string[] | null {
	const [head, tail, extra] = ip.split('::');
	if (extra !== undefined) return null;
	const left = head ? head.split(':') : [];
	const right = tail !== undefined && tail ? tail.split(':') : [];
	const missing = 8 - left.length - right.length;
	if (tail === undefined ? missing !== 0 : missing < 1) return null;
	return [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right];
}

/**
 * Bucket identity for an address. IPv6 collapses to its /64 — a single host routinely
 * owns a whole /64, so per-address buckets would let one client rotate through 2^64
 * fresh buckets. IPv4-mapped IPv6 is unwrapped to plain IPv4.
 */
export function ipBucketKey(ip: string, prefixGroups = 4): string {
	const host = stripMapped(ip);
	if (isIP(host) !== 6) return host;
	const groups = expandIpv6(host.toLowerCase().split('%')[0]!);
	if (!groups) return host;
	return `${groups
		.slice(0, prefixGroups)
		.map((g) => g.replace(/^0+(?=.)/, ''))
		.join(':')}::/${prefixGroups * 16}`;
}

/** Lockout buckets are what stop brute force — evict them only as a last resort. */
const PROTECTED_PREFIX = 'authfail:';

function pruneBuckets(now: number): void {
	if (buckets.size < MAX_BUCKETS) return;
	for (const [k, b] of buckets) {
		if (b.resetAt <= now) buckets.delete(k);
	}
	// Still full of live buckets: evict oldest-inserted (Map preserves insertion order),
	// ordinary buckets first so a flood can't flush failed-credential lockouts.
	let excess = buckets.size - MAX_BUCKETS + 1;
	for (const pass of [false, true]) {
		if (excess <= 0) break;
		for (const k of buckets.keys()) {
			if (excess <= 0) break;
			if (!pass && k.startsWith(PROTECTED_PREFIX)) continue;
			buckets.delete(k);
			excess -= 1;
		}
	}
}

/** Test/diagnostic helper — current number of tracked buckets. */
export function bucketCount(): number {
	return buckets.size;
}

/**
 * Fixed-window rate limit. Returns Retry-After seconds if limited, else null.
 * In-memory only — fine for single-node Voice; not shared across processes.
 */
export function takeRateLimit(
	key: string,
	limit: number,
	windowMs: number
): { ok: true } | { ok: false; retryAfterSec: number } {
	const now = Date.now();
	const cur = buckets.get(key);
	if (!cur || cur.resetAt <= now) {
		if (cur) buckets.delete(key);
		pruneBuckets(now);
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { ok: true };
	}
	if (cur.count >= limit) {
		return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
	}
	cur.count += 1;
	return { ok: true };
}

/** True when `key`'s current window is already at/over `limit` — does not consume. */
export function isRateLimited(key: string, limit: number): boolean {
	const cur = buckets.get(key);
	if (!cur || cur.resetAt <= Date.now()) return false;
	return cur.count >= limit;
}

/**
 * Failed-credential budgets per client address. Checked BEFORE a credential is evaluated,
 * so once exhausted every guess from that address answers "no" without being tested.
 *
 * Two independent kinds, so one can't be used to lock out the other:
 * - `key`: raw voice keys and setup tokens (`?k=`, body, headers). A cross-site page can
 *   make a victim's browser send these (e.g. `<img src="…?k=x">`), so a key lockout must
 *   never block an already-signed-in user.
 * - `cookie`: Lounge / setup session cookies. Another site can't set these for us
 *   (`__Host-` prefix), so only the browser holding them can burn this budget. Still
 *   counted: a cookie is an HMAC of the voice key, i.e. an offline-computable key guess.
 *
 * IPv6 additionally has a coarser /48 tier so a holder of many /64s can't multiply
 * their budget.
 */
export type AuthFailureKind = 'key' | 'cookie';

export const FAILED_AUTH = { limit: 20, windowMs: 15 * 60_000 } as const;
export const FAILED_AUTH_V6_48 = { limit: 200, windowMs: 15 * 60_000 } as const;

function failedAuthKeys(
	event: RequestEvent,
	kind: AuthFailureKind
): Array<{ key: string; limit: number; windowMs: number }> {
	const ip = clientIp(event);
	const keys: Array<{ key: string; limit: number; windowMs: number }> = [
		{
			key: `${PROTECTED_PREFIX}${kind}:${ipBucketKey(ip)}`,
			limit: FAILED_AUTH.limit,
			windowMs: FAILED_AUTH.windowMs
		}
	];
	if (isIP(stripMapped(ip)) === 6) {
		keys.push({
			key: `${PROTECTED_PREFIX}${kind}:${ipBucketKey(ip, 3)}`,
			limit: FAILED_AUTH_V6_48.limit,
			windowMs: FAILED_AUTH_V6_48.windowMs
		});
	}
	return keys;
}

export function isAuthLockedOut(event: RequestEvent, kind: AuthFailureKind = 'key'): boolean {
	return failedAuthKeys(event, kind).some((b) => isRateLimited(b.key, b.limit));
}

/** Per-request dedupe: hooks + route both resolve the same credential on one request. */
const countedFailures = new WeakMap<Request, Set<string>>();

/** Count one failed credential attempt — at most once per (request, credential). */
export function recordAuthFailure(
	event: RequestEvent,
	credential: string,
	kind: AuthFailureKind = 'key'
): void {
	let seen = countedFailures.get(event.request);
	if (!seen) {
		seen = new Set();
		countedFailures.set(event.request, seen);
	}
	const id = `${kind}:${credential}`;
	if (seen.has(id)) return;
	seen.add(id);
	for (const b of failedAuthKeys(event, kind)) takeRateLimit(b.key, b.limit, b.windowMs);
}

/**
 * Throws a 429. SvelteKit turns a thrown `Response` from an endpoint into a 500, and its
 * `error()` drops custom headers — so the Retry-After value rides on `event.locals` and
 * `hooks.server.ts` copies it onto the 429 response.
 */
export function enforceRateLimit(
	event: RequestEvent,
	bucket: string,
	limit: number,
	windowMs: number,
	principalId?: string
): void {
	const ip = ipBucketKey(clientIp(event));
	const key = principalId ? `${bucket}:p:${principalId}:${ip}` : `${bucket}:ip:${ip}`;
	const result = takeRateLimit(key, limit, windowMs);
	if (!result.ok) {
		if (event.locals) event.locals.retryAfterSec = result.retryAfterSec;
		error(429, `Rate limited; retry after ${result.retryAfterSec}s`);
	}
}

export const RATE = {
	unlock: { limit: 5, windowMs: 15 * 60_000 },
	mint: { limit: 30, windowMs: 60_000 },
	hermes: { limit: 20, windowMs: 60_000 },
	// Dedicated bucket — a greeting retry storm must not eat the budget the real
	// ask_hermes tool-bridge depends on.
	greeting: { limit: 6, windowMs: 60_000 },
	// Dedicated bucket — memory review fires at most once per hands-free conversation end;
	// a retry storm here must not eat the ask_hermes tool-bridge budget either. The
	// per-binding in-flight concurrency cap (routes/api/memory-review) is separate from
	// this fixed-window request-rate bucket.
	memoryReview: { limit: 4, windowMs: 60_000 },
	setupProbe: { limit: 20, windowMs: 60_000 },
	setupSave: { limit: 10, windowMs: 60_000 },
	ownerHealth: { limit: 10, windowMs: 60_000 },
	ownerMutate: { limit: 30, windowMs: 60_000 },
	authExchange: { limit: 20, windowMs: 60_000 },
	// Dedicated bucket for the xAI voice-list fetch (chunk B) — do NOT reuse setupProbe,
	// which is shared with the four existing Test buttons; a debounced key-typing fetch
	// against a shared bucket would 429 the owner's own connectivity test.
	voiceList: { limit: 6, windowMs: 60_000 },
	// Dedicated bucket for the settings self-restart action (chunk D) — separate from
	// voiceList and setupSave so a restart-button mis-click storm can't eat either budget.
	setupRestart: { limit: 3, windowMs: 5 * 60_000 },
	// Shared by all four async-task routes (dispatch/ack/clear/stream) — a single bucket
	// across them is intentional, they're all cheap per-call and part of one feature.
	tasks: { limit: 30, windowMs: 60_000 },
	// Owner-only caption debug sink (CAPTION_DEBUG=1) — the client flushes every ~400ms
	// while captions animate, so this is sized for that, not for a human.
	debugCaptions: { limit: 120, windowMs: 60_000 }
} as const;
