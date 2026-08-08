import { createHash } from 'node:crypto';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';
import { redactForLog } from '$lib/server/logRedact';
import type { VoiceInfo } from '../types';
import { TTS_VOICES_URL } from './constants';

export type VoicesProbeCode = 'missing_key' | 'fetch_failed' | 'fetch_upstream';

export type VoicesResult = { ok: true; voices: VoiceInfo[] } | { ok: false; code: VoicesProbeCode };

const CACHE_TTL_MS = 10 * 60_000;

type CacheEntry = { voices: VoiceInfo[]; expiresAt: number };

/** Keyed by a key fingerprint (never the raw key) so a rotation busts the cache. */
let cache: { fingerprint: string; entry: CacheEntry } | null = null;

/** First 8 hex chars of a SHA-256 of the key — enough to detect a rotation, never reversible to the key. */
function keyFingerprint(apiKey: string): string {
	return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 8);
}

function parseVoices(body: unknown): VoiceInfo[] {
	const list =
		body && typeof body === 'object' && Array.isArray((body as { voices?: unknown }).voices)
			? (body as { voices: unknown[] }).voices
			: [];

	const voices: VoiceInfo[] = [];
	for (const row of list) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const id = typeof r.voice_id === 'string' ? r.voice_id.trim() : '';
		if (!id) continue;
		const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id;
		const language =
			typeof r.language === 'string' && r.language.trim() ? r.language.trim() : undefined;
		voices.push({ id, name, language });
	}
	return voices;
}

/**
 * Fetch xAI's TTS voice catalog (`GET /v1/tts/voices`). Non-throwing; mirrors the
 * `{ok:true,...} | {ok:false, code}` shape of `mint.server.ts`. Never logs the API key;
 * any upstream error body is redacted before logging. Cached per key-fingerprint for
 * `CACHE_TTL_MS` — there is no published rate limit for this endpoint, 10 minutes is a
 * conservative default, not derived from docs.
 *
 * NOTE (see chunk B research findings / CHANGELOG): this is xAI's **TTS** voice
 * catalog — whether a `voice_id` from it is accepted on the **realtime**
 * `session.voice` field is unverified pending a live-key check.
 */
export async function fetchXaiVoices(apiKeyOverride?: string): Promise<VoicesResult> {
	const apiKey = apiKeyOverride?.trim() || readEnvTrimmed('XAI_API_KEY');
	if (!apiKey) {
		return { ok: false, code: 'missing_key' };
	}

	const fingerprint = keyFingerprint(apiKey);
	const now = Date.now();
	if (cache && cache.fingerprint === fingerprint && cache.entry.expiresAt > now) {
		return { ok: true, voices: cache.entry.voices };
	}

	let upstream: Response;
	try {
		upstream = await fetch(TTS_VOICES_URL, {
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(5_000)
		});
	} catch {
		return { ok: false, code: 'fetch_failed' };
	}

	const rawText = await upstream.text().catch(() => '');

	if (!upstream.ok) {
		console.error(`xAI tts/voices HTTP ${upstream.status}: ${redactForLog(rawText)}`);
		return { ok: false, code: 'fetch_upstream' };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		console.error('xAI tts/voices: non-JSON body');
		return { ok: false, code: 'fetch_failed' };
	}

	const voices = parseVoices(parsed);
	cache = { fingerprint, entry: { voices, expiresAt: now + CACHE_TTL_MS } };
	return { ok: true, voices };
}
