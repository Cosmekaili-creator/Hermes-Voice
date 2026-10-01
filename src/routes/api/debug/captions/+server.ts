import { error, json, type RequestHandler } from '@sveltejs/kit';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { requireOwner } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';

/** Default outside systemd PrivateTmp so operators can read it easily. */
function debugDir(): string {
	return readEnvTrimmed('CAPTION_DEBUG_DIR') ?? '/var/tmp/hermes-voice-debug';
}
const MAX_EVENTS = 250;
/** Hard ceiling on the sink file — a debug aid must never be able to fill the disk. */
const MAX_DEBUG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STRING_CHARS = 32;

/**
 * The only fields the caption debugger legitimately sends (see `captionSnap()` in
 * voiceSession.svelte.ts). Everything else — notably the `preview` text fragment, which is
 * conversation content — is dropped, and values are restricted to scalars.
 */
const ALLOWED_FIELDS = new Set([
	't',
	'type',
	'phase',
	'buf',
	'reveal',
	'lines',
	'soft',
	'ahead',
	'state',
	'play',
	'bufAudio',
	'speakProg',
	'media',
	'audioDelta',
	'deltaLen',
	'shouldSettleUi'
]);

function sanitizeEvent(ev: unknown): Record<string, unknown> | null {
	if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return null;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(ev as Record<string, unknown>)) {
		if (!ALLOWED_FIELDS.has(key)) continue;
		if (value === null || typeof value === 'boolean') out[key] = value;
		else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
		else if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING_CHARS);
	}
	return typeof out.type === 'string' ? out : null;
}

/** Disabled unless the operator opts in with CAPTION_DEBUG=1 (env, not a browser toggle). */
function captionDebugEnabled(): boolean {
	return readEnvTrimmed('CAPTION_DEBUG') === '1';
}

/**
 * Caption sync debug sink — owner-only, opt-in (`CAPTION_DEBUG=1`), rate-limited,
 * size-capped. Enable the client with ?cdbg=1 — writes JSONL for live investigation.
 */
export const POST: RequestHandler = async (event) => {
	if (!captionDebugEnabled()) {
		error(404, 'Not found');
	}
	assertSameOrigin(event);
	const body = (await event.request.json().catch(() => null)) as {
		session?: unknown;
		events?: unknown;
		k?: unknown;
	} | null;

	const binding = await requireOwner(event, body ?? {});
	enforceRateLimit(
		event,
		'debugCaptions',
		RATE.debugCaptions.limit,
		RATE.debugCaptions.windowMs,
		binding.id
	);

	const session =
		typeof body?.session === 'string'
			? body.session.slice(0, 80).replace(/[^A-Za-z0-9_.:-]/g, '')
			: 'unknown';
	const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
	if (events.length === 0) {
		error(400, 'No events');
	}

	const receivedAt = Date.now();
	const lines: string[] = [];
	for (const ev of events) {
		const clean = sanitizeEvent(ev);
		if (!clean) continue;
		lines.push(JSON.stringify({ receivedAt, session, ...clean }));
	}
	if (lines.length === 0) {
		error(400, 'No valid events');
	}

	const dir = debugDir();
	const file = path.join(dir, 'captions.jsonl');
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const payload = `${lines.join('\n')}\n`;
	const size = await stat(file).then(
		(s) => s.size,
		() => 0
	);
	if (size + Buffer.byteLength(payload) > MAX_DEBUG_FILE_BYTES) {
		return json({ ok: false, code: 'debug_file_full' }, { status: 507 });
	}
	await appendFile(file, payload, { encoding: 'utf8', mode: 0o600 });
	return json({ ok: true, wrote: lines.length });
};
