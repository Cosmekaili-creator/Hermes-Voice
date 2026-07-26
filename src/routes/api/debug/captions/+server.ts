import { error, json, type RequestHandler } from '@sveltejs/kit';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { requireVoiceKey } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/origin.server';

/** Outside systemd PrivateTmp so operators can read it easily. */
const DEBUG_DIR = '/var/tmp/hermes-voice-debug';
const DEBUG_FILE = path.join(DEBUG_DIR, 'captions.jsonl');
const MAX_EVENTS = 250;

/**
 * Caption sync debug sink (session-authenticated).
 * Enable client with ?cdbg=1 — writes JSONL for live investigation.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = (await event.request.json().catch(() => null)) as {
		session?: unknown;
		events?: unknown;
		k?: unknown;
	} | null;

	await requireVoiceKey(event, body ?? {});

	const session = typeof body?.session === 'string' ? body.session.slice(0, 80) : 'unknown';
	const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
	if (events.length === 0) {
		error(400, 'No events');
	}

	const receivedAt = Date.now();
	const lines: string[] = [];
	for (const ev of events) {
		if (!ev || typeof ev !== 'object') continue;
		lines.push(
			JSON.stringify({
				receivedAt,
				session,
				...(ev as Record<string, unknown>)
			})
		);
	}
	if (lines.length === 0) {
		error(400, 'No valid events');
	}

	await mkdir(DEBUG_DIR, { recursive: true });
	await appendFile(DEBUG_FILE, `${lines.join('\n')}\n`, 'utf8');
	return json({ ok: true, wrote: lines.length });
};
