import { describe, expect, it } from 'vitest';
import { isAllowedHermesHost, ipv4ToInt } from './hermesAllowlist';

describe('isAllowedHermesHost', () => {
	it('allows loopback', () => {
		expect(isAllowedHermesHost('127.0.0.1')).toBe(true);
		expect(isAllowedHermesHost('localhost')).toBe(true);
		expect(isAllowedHermesHost('::1')).toBe(true);
	});

	it('allows RFC1918 private ranges', () => {
		expect(isAllowedHermesHost('192.168.1.1')).toBe(true);
		expect(isAllowedHermesHost('172.16.0.1')).toBe(true);
		expect(isAllowedHermesHost('172.31.255.255')).toBe(true);
		expect(isAllowedHermesHost('10.0.0.1')).toBe(true);
		expect(isAllowedHermesHost('10.255.255.255')).toBe(true);
	});

	it('denies public IPs', () => {
		expect(isAllowedHermesHost('8.8.8.8')).toBe(false);
		expect(isAllowedHermesHost('1.1.1.1')).toBe(false);
	});

	it('denies link-local and cloud metadata targets', () => {
		expect(isAllowedHermesHost('169.254.1.1')).toBe(false);
		expect(isAllowedHermesHost('169.254.169.254')).toBe(false);
		expect(isAllowedHermesHost('metadata.google.internal')).toBe(false);
	});

	it('allows .local hostnames but not arbitrary public DNS names', () => {
		expect(isAllowedHermesHost('hermes.local')).toBe(true);
		expect(isAllowedHermesHost('example.com')).toBe(false);
	});

	/**
	 * Regression for C-M1: Int32 bitwise `&` is signed in JS. Without `>>> 0`
	 * before comparing to the unsigned network mask, 192.168/172.16 wrongly
	 * fail the allowlist check.
	 */
	it('regression: signed Int32 compare must not reject 192.168/172.16', () => {
		const n = ipv4ToInt('192.168.1.1');
		expect(n).not.toBeNull();
		const signedBug = (n! & 0xffff0000) === 0xc0a80000;
		expect(signedBug).toBe(false);
		const fixed = (n! & 0xffff0000) >>> 0 === 0xc0a80000;
		expect(fixed).toBe(true);
		expect(isAllowedHermesHost('192.168.1.1')).toBe(true);
	});
});
