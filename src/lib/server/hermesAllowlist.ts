import { isIP } from 'node:net';

/** Block obvious cloud metadata / link-local targets. */
export function isBlockedHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		host === 'metadata.google.internal' ||
		host === 'metadata' ||
		host.endsWith('.metadata.google.internal')
	) {
		return true;
	}
	if (host === '169.254.169.254' || host === 'fd00:ec2::254') {
		return true;
	}
	return false;
}

export function ipv4ToInt(ip: string): number | null {
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

/** Prefer loopback / RFC1918 private for self-host Hermes. */
export function isAllowedHermesHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (isBlockedHost(host)) return false;

	if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

	const kind = isIP(host);
	if (kind === 4) {
		const n = ipv4ToInt(host);
		if (n === null) return false;
		// Bitwise & is Int32 — compare unsigned masks (>>> 0) so 192.168/172.16 work.
		// 10.0.0.0/8
		if ((n & 0xff000000) >>> 0 === 0x0a000000) return true;
		// 172.16.0.0/12
		if ((n & 0xfff00000) >>> 0 === 0xac100000) return true;
		// 192.168.0.0/16
		if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true;
		// 127.0.0.0/8
		if ((n & 0xff000000) >>> 0 === 0x7f000000) return true;
		// block link-local 169.254.0.0/16
		if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return false;
		return false;
	}

	if (kind === 6) {
		if (host === '::1') return true;
		// Unique local fc00::/7
		if (host.startsWith('fc') || host.startsWith('fd')) return true;
		return false;
	}

	// Non-IP hostnames: localhost / .local only (no public DNS SSRF).
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		return true;
	}
	return false;
}

/**
 * Canonical `host:port` key for a Hermes endpoint: lowercase host, IPv6 without brackets,
 * default port from the scheme (80 / 443), `localhost` folded onto `127.0.0.1`.
 */
export function hermesTargetKey(url: URL): string {
	let host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost') host = '127.0.0.1';
	const port = url.port || (url.protocol === 'https:' ? '443' : '80');
	return `${host}:${port}`;
}

/**
 * Parse one allowlist entry (`host:port`, `[v6]:port`, or a full base URL) into its
 * canonical key. A bare `host` means port 80. Returns null when it doesn't parse.
 */
export function parseHermesTargetEntry(entry: string): string | null {
	const t = entry.trim();
	if (!t) return null;
	try {
		return hermesTargetKey(new URL(t.includes('://') ? t : `http://${t}`));
	} catch {
		return null;
	}
}

/**
 * Explicit target allowlist on top of the host-class floor (`isAllowedHermesHost`): the
 * base must be one of the configured `host:port` endpoints, so a loopback/RFC1918 base
 * can't be pointed at an arbitrary local service (Redis, a database, a metadata proxy).
 */
export function isAllowedHermesTarget(url: string | URL, allowed: Set<string>): boolean {
	try {
		const u = typeof url === 'string' ? new URL(url) : url;
		return allowed.has(hermesTargetKey(u));
	} catch {
		return false;
	}
}
