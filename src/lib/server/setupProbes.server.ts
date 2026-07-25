import { env } from '$env/dynamic/private';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { probeMint as probeOpenAIMint } from '$lib/providers/openai/mint.server';
import { probeMint as probeXaiMint } from '$lib/providers/xai/mint.server';
import { isAllowedHermesHost } from '$lib/server/hermesAllowlist';

export { isAllowedHermesHost } from '$lib/server/hermesAllowlist';

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

export type HermesFetchTarget =
	| { ok: true; base: string; fetchBase: string; hostHeader?: string }
	| { ok: false; code: string };

/**
 * Validate base, then for non-IP hostnames resolve DNS and re-check the IP allowlist.
 * - http: fetch via resolved IP + Host header (pins against DNS rebinding).
 * - https: allowlist the resolved IP but keep the hostname for TLS/SNI
 *   (no TLS-to-IP rewrite; residual TOCTOU after the check).
 */
export async function resolveHermesFetchTarget(raw: string | null): Promise<HermesFetchTarget> {
	const baseCheck = validateHermesApiBase(raw);
	if (!baseCheck.ok) return baseCheck;

	const url = new URL(baseCheck.base);
	const host = url.hostname;

	if (isIP(host)) {
		return { ok: true, base: baseCheck.base, fetchBase: baseCheck.base };
	}

	let address: string;
	try {
		const result = await lookup(host, { family: 4 });
		address = result.address;
	} catch {
		return { ok: false, code: 'base_not_allowed' };
	}

	if (!isAllowedHermesHost(address)) {
		return { ok: false, code: 'base_not_allowed' };
	}

	if (url.protocol === 'https:') {
		return { ok: true, base: baseCheck.base, fetchBase: baseCheck.base };
	}

	const fetchUrl = new URL(baseCheck.base);
	fetchUrl.hostname = address;
	return {
		ok: true,
		base: baseCheck.base,
		fetchBase: fetchUrl.toString().replace(/\/$/, ''),
		hostHeader: host
	};
}

export async function probeXai(apiKey?: string | null): Promise<ProbeResult> {
	const key = nonEmpty(apiKey);
	const result = await probeXaiMint(key ?? undefined);
	if (!result.ok) return { ok: false, code: result.code };
	return { ok: true };
}

export async function probeOpenAI(apiKey?: string | null): Promise<ProbeResult> {
	const key = nonEmpty(apiKey);
	const result = await probeOpenAIMint(key ?? undefined);
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
	const target = await resolveHermesFetchTarget(
		opts.hermesApiBase ?? process.env.HERMES_API_BASE ?? env.HERMES_API_BASE ?? null
	);
	if (!target.ok) {
		return { ok: false, code: target.code };
	}
	const key =
		nonEmpty(opts.hermesApiKey) ||
		nonEmpty(process.env.HERMES_API_KEY) ||
		nonEmpty(env.HERMES_API_KEY);
	if (!key) return { ok: false, code: 'missing_key' };

	const base = target.fetchBase;
	const hostHeaders: Record<string, string> = target.hostHeader
		? { Host: target.hostHeader }
		: {};
	const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);

	let healthRes: Response;
	try {
		healthRes = await fetch(`${base}/health`, {
			method: 'GET',
			headers: hostHeaders,
			signal
		});
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
			headers: { Authorization: `Bearer ${key}`, ...hostHeaders },
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
