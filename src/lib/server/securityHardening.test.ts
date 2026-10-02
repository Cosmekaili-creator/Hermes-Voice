import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { derivedSessionToken, isStrongVoiceKey, resolveBinding } from './auth';
import {
	bucketCount,
	clientIp,
	FAILED_AUTH,
	FAILED_AUTH_V6_48,
	ipBucketKey,
	isAuthLockedOut,
	MAX_BUCKETS,
	recordAuthFailure,
	takeRateLimit
} from './rateLimit.server';
import { probeHermes, sameHermesBase } from './setupProbes.server';

const ORIGIN = 'https://voice.example.com';

let ipCounter = 0;
function uniquePublicIp(): string {
	ipCounter += 1;
	return `203.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

function makeEvent(opts: {
	peer?: string;
	headers?: Record<string, string>;
	path?: string;
	cookies?: Record<string, string>;
	deleted?: string[];
}): RequestEvent {
	const headers = new Headers(opts.headers ?? {});
	const url = new URL(`${ORIGIN}${opts.path ?? '/api/session'}`);
	const jar = { ...(opts.cookies ?? {}) };
	return {
		request: new Request(url, { method: 'GET', headers }),
		url,
		cookies: {
			get: (name: string) => jar[name],
			getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
			set: () => {},
			delete: (name: string) => {
				delete jar[name];
				opts.deleted?.push(name);
			},
			serialize: () => ''
		},
		getClientAddress: () => opts.peer ?? uniquePublicIp(),
		locals: { locale: 'en', principal: null },
		params: {},
		route: { id: null },
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		platform: undefined,
		setHeaders: () => {},
		fetch: globalThis.fetch
	} as unknown as RequestEvent;
}

describe('clientIp (H1 — no spoofable client headers)', () => {
	afterEach(() => {
		delete process.env.ADDRESS_HEADER;
	});

	it('ignores X-Forwarded-For / X-Real-IP from a public direct peer', () => {
		const ev = makeEvent({
			peer: '198.51.100.7',
			headers: { 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' }
		});
		expect(clientIp(ev)).toBe('198.51.100.7');
	});

	it('behind a loopback proxy, takes the RIGHT-most XFF entry (the one nginx appended)', () => {
		const ev = makeEvent({
			peer: '127.0.0.1',
			headers: { 'x-forwarded-for': 'spoofed-1, spoofed-2, 198.51.100.9' }
		});
		expect(clientIp(ev)).toBe('198.51.100.9');
	});

	it('a rotating client-supplied XFF prefix no longer yields fresh buckets', () => {
		const a = makeEvent({ peer: '127.0.0.1', headers: { 'x-forwarded-for': 'a, 198.51.100.10' } });
		const b = makeEvent({ peer: '127.0.0.1', headers: { 'x-forwarded-for': 'b, 198.51.100.10' } });
		expect(clientIp(a)).toBe(clientIp(b));
	});

	it('never trusts X-Real-IP; a trusted proxy without XFF maps to the peer', () => {
		expect(clientIp(makeEvent({ peer: '::1', headers: { 'x-real-ip': '198.51.100.11' } }))).toBe(
			'::1'
		);
	});

	it('does NOT trust private-range peers by default (LAN / port-forward exposure)', () => {
		const ev = makeEvent({ peer: '10.0.0.5', headers: { 'x-forwarded-for': '10.9.0.77' } });
		expect(clientIp(ev)).toBe('10.0.0.5');
		const v6 = makeEvent({ peer: 'fd00::5', headers: { 'x-forwarded-for': '2001:db8::9' } });
		expect(clientIp(v6)).toBe('fd00::5');
	});

	it('trusts peers listed in TRUSTED_PROXY_IPS (IPv4 CIDR / exact)', () => {
		process.env.TRUSTED_PROXY_IPS = '172.17.0.0/16, fd00::1';
		try {
			const docker = makeEvent({
				peer: '172.17.0.1',
				headers: { 'x-forwarded-for': 'x, 198.51.100.40' }
			});
			expect(clientIp(docker)).toBe('198.51.100.40');
			const v6 = makeEvent({ peer: 'fd00::1', headers: { 'x-forwarded-for': '198.51.100.41' } });
			expect(clientIp(v6)).toBe('198.51.100.41');
			const other = makeEvent({
				peer: '172.18.0.1',
				headers: { 'x-forwarded-for': '198.51.100.42' }
			});
			expect(clientIp(other)).toBe('172.18.0.1');
		} finally {
			delete process.env.TRUSTED_PROXY_IPS;
		}
	});

	it('trusts the adapter-resolved address verbatim when ADDRESS_HEADER is configured', () => {
		process.env.ADDRESS_HEADER = 'True-Client-IP';
		const ev = makeEvent({ peer: '198.51.100.12', headers: { 'x-forwarded-for': '9.9.9.9' } });
		expect(clientIp(ev)).toBe('198.51.100.12');
	});
});

describe('ipBucketKey', () => {
	it('collapses IPv6 to /64 and unwraps IPv4-mapped addresses', () => {
		expect(ipBucketKey('2001:db8:0:1:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
		expect(ipBucketKey('2001:db8:0:1::5')).toBe('2001:db8:0:1::/64');
		expect(ipBucketKey('2001:0db8:0000:0001:ffff::1')).toBe('2001:db8:0:1::/64');
		expect(ipBucketKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
		expect(ipBucketKey('192.0.2.1')).toBe('192.0.2.1');
	});
});

describe('IPv6 /48 tier', () => {
	it('many distinct /64s inside one /48 still hit the coarser lockout', () => {
		const base = `2001:db8:${((Math.random() * 0xfff0) | 0).toString(16)}`;
		for (let i = 0; i < FAILED_AUTH_V6_48.limit; i++) {
			recordAuthFailure(makeEvent({ peer: `${base}:${i.toString(16)}::1` }), `g${i}`);
		}
		expect(isAuthLockedOut(makeEvent({ peer: `${base}:ffff::1` }))).toBe(true);
	});
});

describe('rate-limit store cap (M3)', () => {
	it('never grows past MAX_BUCKETS even when flooded with live keys', () => {
		const tag = Math.random().toString(36).slice(2);
		for (let i = 0; i < MAX_BUCKETS + 500; i++) {
			takeRateLimit(`flood:${tag}:${i}`, 5, 60 * 60_000);
		}
		expect(bucketCount()).toBeLessThanOrEqual(MAX_BUCKETS);
	});

	it('a flood of ordinary buckets does not flush an active lockout', () => {
		const peer = uniquePublicIp();
		for (let i = 0; i < FAILED_AUTH.limit; i++) recordAuthFailure(makeEvent({ peer }), `f${i}`);
		expect(isAuthLockedOut(makeEvent({ peer }))).toBe(true);
		const tag = Math.random().toString(36).slice(2);
		for (let i = 0; i < MAX_BUCKETS + 50; i++) takeRateLimit(`flood2:${tag}:${i}`, 5, 60 * 60_000);
		expect(isAuthLockedOut(makeEvent({ peer }))).toBe(true);
	});
});

describe('failed-credential lockout (H2)', () => {
	it('locks an address out after FAILED_AUTH.limit distinct failures', () => {
		const peer = uniquePublicIp();
		for (let i = 0; i < FAILED_AUTH.limit; i++) {
			expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
			recordAuthFailure(makeEvent({ peer }), `guess-${i}`);
		}
		expect(isAuthLockedOut(makeEvent({ peer }))).toBe(true);
		// Key failures never lock the cookie kind.
		expect(isAuthLockedOut(makeEvent({ peer }), 'cookie')).toBe(false);
		// Other addresses unaffected.
		expect(isAuthLockedOut(makeEvent({ peer: uniquePublicIp() }))).toBe(false);
	});

	it('counts the same credential at most once per request (hooks + route double-resolve)', () => {
		const peer = uniquePublicIp();
		const ev = makeEvent({ peer });
		for (let i = 0; i < FAILED_AUTH.limit + 5; i++) recordAuthFailure(ev, 'same');
		expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
	});

	describe('resolveBinding integration (single-user)', () => {
		const KEY = 'correct-horse-battery-staple-0123456789';
		beforeEach(() => {
			delete process.env.MULTI_USER;
			process.env.VOICE_URL_KEY = KEY;
		});
		afterEach(() => {
			delete process.env.VOICE_URL_KEY;
		});

		it('a raw-key lockout does NOT sign out a browser holding a valid cookie (verifier #1)', async () => {
			const peer = uniquePublicIp();
			for (let i = 0; i < FAILED_AUTH.limit; i++) {
				await resolveBinding(makeEvent({ peer, path: `/health?k=x${i}` }));
			}
			expect(isAuthLockedOut(makeEvent({ peer }))).toBe(true);
			const withCookie = await resolveBinding(
				makeEvent({ peer, path: '/?k=bad', cookies: { '__Host-hv': derivedSessionToken(KEY) } })
			);
			expect(withCookie?.id).toBe('env');
		});

		it('cross-site subresource ?k= (e.g. <img>) is ignored: not evaluated, not counted', async () => {
			const peer = uniquePublicIp();
			for (let i = 0; i < FAILED_AUTH.limit + 5; i++) {
				const b = await resolveBinding(
					makeEvent({
						peer,
						path: `/health?k=x${i}`,
						headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image' }
					})
				);
				expect(b).toBeNull();
			}
			expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
			// …while a cross-site top-level navigation with the right key still unlocks.
			const nav = await resolveBinding(
				makeEvent({
					peer,
					path: `/?k=${KEY}`,
					headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' }
				})
			);
			expect(nav?.id).toBe('env');
		});

		it('a live SETUP_TOKEN sent as Bearer is not counted as a failed voice key (verifier #4)', async () => {
			process.env.SETUP_TOKEN = 'setup-token-for-tests-1234567890';
			try {
				const peer = uniquePublicIp();
				for (let i = 0; i < FAILED_AUTH.limit + 2; i++) {
					await resolveBinding(
						makeEvent({
							peer,
							headers: { authorization: 'Bearer setup-token-for-tests-1234567890' }
						})
					);
				}
				expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
			} finally {
				delete process.env.SETUP_TOKEN;
			}
		});

		it('wrong keys count as failures; once locked, even the RIGHT key is refused', async () => {
			const peer = uniquePublicIp();
			for (let i = 0; i < FAILED_AUTH.limit; i++) {
				const b = await resolveBinding(
					makeEvent({ peer, headers: { 'x-hermes-voice-key': `w${i}` } })
				);
				expect(b).toBeNull();
			}
			const right = await resolveBinding(
				makeEvent({ peer, headers: { 'x-hermes-voice-key': KEY } })
			);
			expect(right).toBeNull();
			// A different address still authenticates normally.
			const elsewhere = await resolveBinding(
				makeEvent({ peer: uniquePublicIp(), headers: { 'x-hermes-voice-key': KEY } })
			);
			expect(elsewhere?.id).toBe('env');
		});

		it('anonymous requests (no credential) are never counted', async () => {
			const peer = uniquePublicIp();
			for (let i = 0; i < FAILED_AUTH.limit + 5; i++) {
				await resolveBinding(makeEvent({ peer }));
			}
			expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
		});

		it('a valid session cookie still works; a stale one is cleared', async () => {
			const ok = await resolveBinding(
				makeEvent({ cookies: { '__Host-hv': derivedSessionToken(KEY) } })
			);
			expect(ok?.id).toBe('env');

			const deleted: string[] = [];
			const stale = await resolveBinding(
				makeEvent({ cookies: { '__Host-hv': derivedSessionToken('old-key') }, deleted })
			);
			expect(stale).toBeNull();
			expect(deleted).toContain('__Host-hv');
		});

		it('does not count or clear cookies when no key is configured (store unavailable)', async () => {
			delete process.env.VOICE_URL_KEY;
			const peer = uniquePublicIp();
			const deleted: string[] = [];
			for (let i = 0; i < FAILED_AUTH.limit + 2; i++) {
				await resolveBinding(makeEvent({ peer, cookies: { '__Host-hv': `c${i}` }, deleted }));
			}
			expect(isAuthLockedOut(makeEvent({ peer }))).toBe(false);
			expect(deleted).toHaveLength(0);
		});
	});
});

describe('isStrongVoiceKey (H3)', () => {
	it('rejects short and trivially repetitive keys', () => {
		expect(isStrongVoiceKey('a')).toBe(false);
		expect(isStrongVoiceKey('short-key-123')).toBe(false);
		expect(isStrongVoiceKey('a'.repeat(40))).toBe(false);
		expect(isStrongVoiceKey('abababababababababababababab')).toBe(false);
		expect(isStrongVoiceKey('aaaaaaaaaaaaaaaaaaabcdef')).toBe(false);
		expect(isStrongVoiceKey('password1234password1234')).toBe(false);
	});
	it('accepts generated-style keys', () => {
		expect(isStrongVoiceKey('3f9a1c0be24d7e65a8b1c3d5e7f90a2b4c6d8e0f1a2b3c4d')).toBe(true);
		expect(isStrongVoiceKey('correct-horse-battery-staple-42')).toBe(true);
	});
});

describe('Hermes key binding to its base (M1)', () => {
	afterEach(() => {
		delete process.env.HERMES_API_BASE;
		delete process.env.HERMES_API_KEY;
	});

	it('sameHermesBase ignores trailing slashes and host case, nothing else', () => {
		expect(sameHermesBase('http://127.0.0.1:8642', 'http://127.0.0.1:8642/')).toBe(true);
		expect(sameHermesBase('http://LOCALHOST:8642', 'http://localhost:8642')).toBe(true);
		expect(sameHermesBase('http://127.0.0.1:8642', 'http://127.0.0.1:8643')).toBe(false);
		expect(sameHermesBase('http://127.0.0.1:8642', 'https://127.0.0.1:8642')).toBe(false);
		expect(sameHermesBase('http://127.0.0.1:8642', null)).toBe(false);
	});

	it('an unset stored base means the default (verifier #3): default base + stored key is allowed', async () => {
		process.env.HERMES_API_KEY = 'stored-secret';
		const result = await probeHermes({ hermesApiBase: 'http://127.0.0.1:8642/' });
		// Nothing listens there in tests — what matters is it got past the key-binding check.
		expect(result).not.toEqual({ ok: false, code: 'hermes_key_required' });
		const moved = await probeHermes({ hermesApiBase: 'http://10.1.2.3:8642' });
		expect(moved).toEqual({ ok: false, code: 'hermes_key_required' });
	});

	it('probeHermes never sends the stored env key to a caller-supplied base', async () => {
		process.env.HERMES_API_BASE = 'http://127.0.0.1:8642';
		process.env.HERMES_API_KEY = 'stored-secret';
		const result = await probeHermes({ hermesApiBase: 'http://192.168.1.66:8642' });
		expect(result).toEqual({ ok: false, code: 'hermes_key_required' });
	});
});
