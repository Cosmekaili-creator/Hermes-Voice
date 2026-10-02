import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { enforceRateLimit, takeRateLimit } from './rateLimit.server';

/** In-memory bucket map is module-scoped — always use a unique key per test. */
function uniqueKey(name: string): string {
	return `${name}:${Math.random().toString(36).slice(2)}:${Date.now()}`;
}

describe('takeRateLimit', () => {
	it('allows requests under the limit', () => {
		const key = uniqueKey('under-limit');
		expect(takeRateLimit(key, 3, 60_000)).toEqual({ ok: true });
		expect(takeRateLimit(key, 3, 60_000)).toEqual({ ok: true });
		expect(takeRateLimit(key, 3, 60_000)).toEqual({ ok: true });
	});

	it('returns ok:false with retryAfterSec once the limit is exceeded', () => {
		const key = uniqueKey('over-limit');
		expect(takeRateLimit(key, 1, 60_000)).toEqual({ ok: true });
		const result = takeRateLimit(key, 1, 60_000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.retryAfterSec).toBeGreaterThan(0);
		}
	});

	it('tracks distinct keys independently', () => {
		const keyA = uniqueKey('key-a');
		const keyB = uniqueKey('key-b');
		expect(takeRateLimit(keyA, 1, 60_000)).toEqual({ ok: true });
		expect(takeRateLimit(keyA, 1, 60_000).ok).toBe(false);
		// A different key must not be affected by A's exhausted bucket.
		expect(takeRateLimit(keyB, 1, 60_000)).toEqual({ ok: true });
	});

	it('resets after the window elapses', () => {
		const key = uniqueKey('window-reset');
		expect(takeRateLimit(key, 1, 10)).toEqual({ ok: true });
		expect(takeRateLimit(key, 1, 10).ok).toBe(false);
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(takeRateLimit(key, 1, 10)).toEqual({ ok: true });
				resolve();
			}, 25);
		});
	});
});

describe('enforceRateLimit', () => {
	it('throws a 429 HttpError (not a raw Response, which SvelteKit turns into a 500) and records Retry-After on locals', () => {
		const locals: { retryAfterSec?: number } = {};
		const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
		const event = {
			request: new Request('https://x.test/api'),
			getClientAddress: () => ip,
			locals
		} as unknown as RequestEvent;
		const bucket = uniqueKey('enforce');
		enforceRateLimit(event, bucket, 1, 60_000);
		let thrown: unknown;
		try {
			enforceRateLimit(event, bucket, 1, 60_000);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).not.toBeInstanceOf(Response);
		expect((thrown as { status?: number }).status).toBe(429);
		expect(locals.retryAfterSec).toBeGreaterThan(0);
	});
});
