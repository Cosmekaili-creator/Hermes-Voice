/**
 * Regression for C-M1: Int32 bitwise & must be compared unsigned.
 * Keep logic aligned with src/lib/server/hermesAllowlist.ts
 */
import assert from 'node:assert/strict';
import { isIP } from 'node:net';

function ipv4ToInt(ip) {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return null;
		n = (n << 8) | o;
	}
	return n >>> 0;
}

function isAllowedHermesHost(hostname) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
	const kind = isIP(host);
	if (kind === 4) {
		const n = ipv4ToInt(host);
		if (n === null) return false;
		if (((n & 0xff000000) >>> 0) === 0x0a000000) return true;
		if (((n & 0xfff00000) >>> 0) === 0xac100000) return true;
		if (((n & 0xffff0000) >>> 0) === 0xc0a80000) return true;
		if (((n & 0xff000000) >>> 0) === 0x7f000000) return true;
		if (((n & 0xffff0000) >>> 0) === 0xa9fe0000) return false;
		return false;
	}
	if (kind === 6) {
		if (host === '::1') return true;
		if (host.startsWith('fc') || host.startsWith('fd')) return true;
		return false;
	}
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		return true;
	}
	return false;
}

// Bug pattern (signed compare) wrongly denies these:
assert.equal(isAllowedHermesHost('192.168.1.1'), true);
assert.equal(isAllowedHermesHost('172.16.0.1'), true);
assert.equal(isAllowedHermesHost('10.0.0.1'), true);
assert.equal(isAllowedHermesHost('127.0.0.1'), true);
assert.equal(isAllowedHermesHost('8.8.8.8'), false);
assert.equal(isAllowedHermesHost('169.254.1.1'), false);
assert.equal(isAllowedHermesHost('hermes.local'), true);

// Prove the signed bug: without >>> 0, 192.168 fails
{
	const n = ipv4ToInt('192.168.1.1');
	assert.ok(n !== null);
	const broken = (n & 0xffff0000) === 0xc0a80000; // signed Int32
	assert.equal(broken, false, 'signed compare must fail for 192.168 (documents the bug)');
	const fixed = ((n & 0xffff0000) >>> 0) === 0xc0a80000;
	assert.equal(fixed, true);
}

console.log('check-allowlist: ok');
