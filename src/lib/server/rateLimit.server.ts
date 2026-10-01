import { type RequestEvent } from '@sveltejs/kit';
import { isIP } from 'node:net';

type Bucket = {
	count: number;
	resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Hard ceiling on tracked buckets — the store must never grow without bound. */
export const MAX_BUCKETS = 10_000;

function isTrustedProxyPeer(ip: string): boolean {
	const host = ip.replace(/^::ffff:/i, '');
	if (host === '::1' || host === 'localhost') return true;
	if (isIP(host) === 4) {
		const [a, b] = host.split('.').map(Number) as [number, number];
		if (a === 127 || a === 10) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		return false;
	}
	if (isIP(host) === 6) {
		const lower = host.toLowerCase();
		return lower.startsWith('fc') || lower.startsWith('fd');
	}
	return false;
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
 * - Direct connection from a public peer: the socket address is authoritative; any
 *   `X-Forwarded-For` / `X-Real-IP` the client sent is ignored.
 * - Peer is loopback / private (a local reverse proxy): take the RIGHT-most
 *   `X-Forwarded-For` entry — the one the proxy itself appended (nginx
 *   `$proxy_add_x_forwarded_for` keeps the client's own spoofable entries on the left).
 *   Falls back to `X-Real-IP`, then the peer address.
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
	const real = event.request.headers.get('x-real-ip')?.trim();
	if (real) return real;
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
export function ipBucketKey(ip: string): string {
	const host = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
	if (isIP(host) !== 6) return host;
	const groups = expandIpv6(host.toLowerCase().split('%')[0]!);
	if (!groups) return host;
	return `${groups
		.slice(0, 4)
		.map((g) => g.replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}

function pruneBuckets(now: number): void {
	if (buckets.size < MAX_BUCKETS) return;
	for (const [k, b] of buckets) {
		if (b.resetAt <= now) buckets.delete(k);
	}
	// Still full of live buckets: evict oldest-inserted (Map preserves insertion order).
	const excess = buckets.size - MAX_BUCKETS + 1;
	if (excess > 0) {
		let removed = 0;
		for (const k of buckets.keys()) {
			if (removed >= excess) break;
			buckets.delete(k);
			removed += 1;
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
 * Failed-credential budget per client address, shared by every credential check (voice
 * key / Lounge cookie / setup token). Checked BEFORE a credential is evaluated, so once
 * exhausted every guess from that address answers "no" without being tested — no oracle.
 */
export const FAILED_AUTH = { limit: 20, windowMs: 15 * 60_000 } as const;

function failedAuthKey(event: RequestEvent): string {
	return `authfail:ip:${ipBucketKey(clientIp(event))}`;
}

export function isAuthLockedOut(event: RequestEvent): boolean {
	return isRateLimited(failedAuthKey(event), FAILED_AUTH.limit);
}

/** Per-request dedupe: hooks + route both resolve the same credential on one request. */
const countedFailures = new WeakMap<Request, Set<string>>();

/** Count one failed credential attempt — at most once per (request, credential). */
export function recordAuthFailure(event: RequestEvent, credential: string): void {
	let seen = countedFailures.get(event.request);
	if (!seen) {
		seen = new Set();
		countedFailures.set(event.request, seen);
	}
	if (seen.has(credential)) return;
	seen.add(credential);
	takeRateLimit(failedAuthKey(event), FAILED_AUTH.limit, FAILED_AUTH.windowMs);
}

/** Throws a Response so Retry-After is preserved (Kit error() drops custom headers). */
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
		throw new Response(`Rate limited; retry after ${result.retryAfterSec}s`, {
			status: 429,
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Retry-After': String(result.retryAfterSec)
			}
		});
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
