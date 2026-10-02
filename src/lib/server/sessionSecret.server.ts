import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readEnvTrimmed } from '$lib/server/runtimeEnv.server';

/**
 * Server-side secret mixed into Lounge session cookies, so a cookie is
 * HMAC(serverSecret, voiceKey) rather than a value anyone can compute from a voice-key
 * guess. That makes cookie guesses useless for brute-forcing keys — the cookie path then
 * needs no failed-attempt lockout, and nobody sharing an IP can sign others out.
 *
 * Source order: `SESSION_SECRET` env → `session.secret` (created 0600 on first use) in
 * systemd's `$STATE_DIRECTORY` if set, else next to `BINDINGS_FILE` / `./data` → an
 * in-memory random secret (logged; sessions then reset on restart).
 * Rotating/deleting the secret signs every browser out (they re-open their `?k=` link).
 */
let cached: string | null = null;

function secretFilePath(): string {
	// systemd `StateDirectory=` (may list several, colon-separated) — writable even under
	// ProtectSystem=strict.
	const stateDir = process.env.STATE_DIRECTORY?.split(':')[0]?.trim();
	if (stateDir) return path.join(stateDir, 'session.secret');
	const bindings = readEnvTrimmed('BINDINGS_FILE');
	const dir = bindings ? path.dirname(path.resolve(bindings)) : path.join(process.cwd(), 'data');
	return path.join(dir, 'session.secret');
}

export function sessionSecret(): string {
	if (cached) return cached;
	const fromEnv = readEnvTrimmed('SESSION_SECRET');
	if (fromEnv && fromEnv.length >= 32) {
		cached = fromEnv;
		return cached;
	}
	if (fromEnv) {
		console.warn('Hermes Voice: SESSION_SECRET is shorter than 32 characters and is ignored.');
	}
	const file = secretFilePath();
	try {
		const existing = readFileSync(file, 'utf8').trim();
		if (existing.length >= 32) {
			cached = existing;
			return cached;
		}
	} catch {
		/* not created yet */
	}
	const fresh = randomBytes(32).toString('hex');
	try {
		mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
		writeFileSync(file, `${fresh}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
		chmodSync(file, 0o600);
		cached = fresh;
	} catch (err) {
		// Lost a create race with another worker → read theirs; otherwise fall back to memory.
		try {
			const raced = readFileSync(file, 'utf8').trim();
			if (raced.length >= 32) {
				cached = raced;
				return cached;
			}
		} catch {
			/* ignore */
		}
		const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'unknown';
		console.warn(
			`Hermes Voice: could not persist ${file} (${code}); using an in-memory session secret — set SESSION_SECRET or make the data dir writable to keep sessions across restarts.`
		);
		cached = fresh;
	}
	return cached;
}

/** Test hook. */
export function resetSessionSecretCache(): void {
	cached = null;
}
