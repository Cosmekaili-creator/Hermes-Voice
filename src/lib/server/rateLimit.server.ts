import { type RequestEvent } from '@sveltejs/kit';

type Bucket = {
	count: number;
	resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Best-effort client IP behind a single reverse proxy hop. */
export function clientIp(event: RequestEvent): string {
	const xf = event.request.headers.get('x-forwarded-for');
	if (xf) {
		const first = xf.split(',')[0]?.trim();
		if (first) return first;
	}
	return event.getClientAddress();
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
	if (buckets.size > 10_000) {
		for (const [k, b] of buckets) {
			if (b.resetAt <= now) buckets.delete(k);
		}
	}

	const cur = buckets.get(key);
	if (!cur || cur.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { ok: true };
	}
	if (cur.count >= limit) {
		return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
	}
	cur.count += 1;
	return { ok: true };
}

/** Throws a Response so Retry-After is preserved (Kit error() drops custom headers). */
export function enforceRateLimit(
	event: RequestEvent,
	bucket: string,
	limit: number,
	windowMs: number,
	principalId?: string
): void {
	const ip = clientIp(event);
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
	authExchange: { limit: 20, windowMs: 60_000 }
} as const;
