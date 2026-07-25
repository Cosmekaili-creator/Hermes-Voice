import { env } from '$env/dynamic/private';
import { isIP } from 'node:net';
import { probeMint } from '$lib/providers/xai/mint.server';

const PROBE_TIMEOUT_MS = 5_000;

export type ProbeOk = { ok: true };
export type ProbeFail = { ok: false; code: string };
export type ProbeResult = ProbeOk | ProbeFail;

export type OriginProbeResult = {
	ok: true;
	warnings: string[];
};

function nonEmpty(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const t = value.trim();
	return t.length > 0 ? t : null;
}

/** Block obvious cloud metadata / link-local targets. */
function isBlockedHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.metadata.google.internal')) {
		return true;
	}
	if (host === '169.254.169.254' || host === 'fd00:ec2::254') {
		return true;
	}
	return false;
}

function ipv4ToInt(ip: string): number | null {
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
		// 10.0.0.0/8
		if ((n & 0xff000000) === 0x0a000000) return true;
		// 172.16.0.0/12
		if ((n & 0xfff00000) === 0xac100000) return true;
		// 192.168.0.0/16
		if ((n & 0xffff0000) === 0xc0a80000) return true;
		// 127.0.0.0/8
		if ((n & 0xff000000) === 0x7f000000) return true;
		// block link-local 169.254.0.0/16
		if ((n & 0xffff0000) === 0xa9fe0000) return false;
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

export type HermesBaseCheck =
	| { ok: true; base: string }
	| { ok: false; code: string };

export function validateHermesApiBase(raw: string | null): HermesBaseCheck {
	const base = nonEmpty(raw);
	if (!base) return { ok: false, code: 'missing_base' };

	let url: URL;
	try {
		url = new URL(base);
	} catch {
		return { ok: false, code: 'invalid_base' };
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { ok: false, code: 'invalid_base' };
	}

	if (!isAllowedHermesHost(url.hostname)) {
		return { ok: false, code: 'base_not_allowed' };
	}

	return { ok: true, base: base.replace(/\/$/, '') };
}

export async function probeXai(apiKey?: string | null): Promise<ProbeResult> {
	const key = nonEmpty(apiKey);
	const result = await probeMint(key ?? undefined);
	if (!result.ok) return { ok: false, code: result.code };
	return { ok: true };
}

/**
 * Hermes probe: reachability via GET /health + API key via GET /v1/models.
 * Never chat/completions. Never return upstream bodies.
 */
export async function probeHermes(opts: {
	hermesApiBase?: string | null;
	hermesApiKey?: string | null;
}): Promise<ProbeResult> {
	const baseCheck = validateHermesApiBase(
		opts.hermesApiBase ?? process.env.HERMES_API_BASE ?? env.HERMES_API_BASE ?? null
	);
	if (!baseCheck.ok) {
		return { ok: false, code: baseCheck.code };
	}
	const key =
		nonEmpty(opts.hermesApiKey) ||
		nonEmpty(process.env.HERMES_API_KEY) ||
		nonEmpty(env.HERMES_API_KEY);
	if (!key) return { ok: false, code: 'missing_key' };

	const base = baseCheck.base;
	const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);

	let healthRes: Response;
	try {
		healthRes = await fetch(`${base}/health`, { method: 'GET', signal });
	} catch {
		return { ok: false, code: 'hermes_unreachable' };
	}

	if (!healthRes.ok) {
		// Drain body without forwarding
		await healthRes.text().catch(() => '');
		return { ok: false, code: 'hermes_unhealthy' };
	}
	await healthRes.text().catch(() => '');

	let modelsRes: Response;
	try {
		modelsRes = await fetch(`${base}/v1/models`, {
			method: 'GET',
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
	} catch {
		return { ok: false, code: 'hermes_unreachable' };
	}

	await modelsRes.text().catch(() => '');

	if (modelsRes.status === 401 || modelsRes.status === 403) {
		return { ok: false, code: 'hermes_unauthorized' };
	}
	if (!modelsRes.ok) {
		return { ok: false, code: 'hermes_unhealthy' };
	}

	return { ok: true };
}

/** Soft ORIGIN check — never hard-blocks save. */
export function probeOrigin(opts: {
	origin?: string | null;
	requestOrigin?: string;
}): OriginProbeResult {
	const warnings: string[] = [];
	const raw = nonEmpty(opts.origin);
	if (!raw) {
		warnings.push('missing_origin');
		return { ok: true, warnings };
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		warnings.push('invalid_origin');
		return { ok: true, warnings };
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		warnings.push('invalid_origin_protocol');
		return { ok: true, warnings };
	}

	if (url.pathname !== '/' && url.pathname !== '') {
		warnings.push('origin_has_path');
	}

	const req = opts.requestOrigin;
	if (req) {
		try {
			const reqUrl = new URL(req);
			if (url.protocol === 'http:' && reqUrl.protocol === 'https:') {
				warnings.push('origin_http_on_https');
			}
			if (url.host !== reqUrl.host) {
				warnings.push('origin_host_mismatch');
			}
		} catch {
			/* ignore */
		}
	}

	return { ok: true, warnings };
}
