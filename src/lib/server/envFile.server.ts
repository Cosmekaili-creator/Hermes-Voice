import { env } from '$env/dynamic/private';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Must match systemd EnvironmentFile= path (default: cwd/.env). */
export function resolveEnvFilePath(): string {
	const fromEnv = env.ENV_FILE?.trim() || process.env.ENV_FILE?.trim();
	if (fromEnv) return path.resolve(fromEnv);
	return path.join(process.cwd(), '.env');
}

export const MANAGED_ENV_KEYS = [
	'VOICE_URL_KEY',
	'VOICE_PROVIDER',
	'XAI_API_KEY',
	'OPENAI_API_KEY',
	'HERMES_API_BASE',
	'HERMES_API_KEY',
	'HERMES_SESSION_KEY',
	'ORIGIN',
	'SETUP_COMPLETE',
	'SETUP_TOKEN',
	'MULTI_USER'
] as const;

export type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

export type EnvUpdates = Partial<Record<ManagedEnvKey, string | null>>;

export type EnvWriteResult =
	{ ok: true; path: string } | { ok: false; code: 'env_write_failed'; message?: string };

function formatEnvValue(value: string): string {
	if (/[\s#"'$`\\]/.test(value) || value === '') {
		const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		return `"${escaped}"`;
	}
	return value;
}

function lineForKey(key: string, value: string): string {
	return `${key}=${formatEnvValue(value)}`;
}

/**
 * Upsert managed keys into existing .env text; preserve unrelated keys and comments.
 * `null` value removes the key (blank line deleted). Undefined keys are not passed.
 */
export function mergeEnvText(existing: string, updates: EnvUpdates): string {
	const pending = new Map<string, string | null>();
	for (const [k, v] of Object.entries(updates)) {
		if (v === undefined) continue;
		pending.set(k, v);
	}

	const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
	const out: string[] = [];

	for (const line of lines) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
		if (!match) {
			out.push(line);
			continue;
		}
		const key = match[1]!;
		if (!pending.has(key)) {
			out.push(line);
			continue;
		}
		const next = pending.get(key)!;
		pending.delete(key);
		if (next === null) continue;
		out.push(lineForKey(key, next));
	}

	for (const [key, value] of pending) {
		if (value === null) continue;
		out.push(lineForKey(key, value));
	}

	let text = out.join('\n');
	if (text.length > 0 && !text.endsWith('\n')) text += '\n';
	return text;
}

export async function readEnvFileText(): Promise<string> {
	const filePath = resolveEnvFilePath();
	try {
		return await readFile(filePath, 'utf8');
	} catch (err) {
		const code =
			err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
		if (code === 'ENOENT') return '';
		throw err;
	}
}

/**
 * Atomic write: create temp with mode 0o600 → rename over target.
 * Prefer create-with-mode so secrets are never briefly world-readable.
 */
export async function writeEnvFileAtomic(updates: EnvUpdates): Promise<EnvWriteResult> {
	const filePath = resolveEnvFilePath();
	const dir = path.dirname(filePath);
	const tmpPath = path.join(dir, `.env.${process.pid}.${Date.now()}.tmp`);

	try {
		await mkdir(dir, { recursive: true });
		const existing = await readEnvFileText();
		const next = mergeEnvText(existing, updates);

		const handle = await open(tmpPath, 'w', 0o600);
		try {
			await handle.writeFile(next, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}

		await rename(tmpPath, filePath);
		return { ok: true, path: filePath };
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			/* ignore cleanup */
		}
		const message = err instanceof Error ? err.message : 'write failed';
		console.error(`envFile write failed: ${message}`);
		return { ok: false, code: 'env_write_failed', message };
	}
}

/** Apply managed keys into process.env after a successful disk write (restart still required). */
export function applyEnvUpdatesInProcess(updates: EnvUpdates): void {
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) continue;
		if (value === null || value === '') {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}
