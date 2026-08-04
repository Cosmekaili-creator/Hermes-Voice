import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PERSONA, normalizePersona, type VoicePersona } from '$lib/persona/types';
import { safeEqualStr } from '$lib/server/cryptoEqual.server';
import {
	applyEnvUpdatesInProcess,
	writeEnvFileAtomic,
	type EnvWriteResult
} from '$lib/server/envFile.server';

export type BindingRole = 'owner' | 'user';

export type Binding = {
	id: string;
	label: string;
	role: BindingRole;
	voiceKey: string;
	hermesApiBase: string;
	hermesApiKey: string;
	hermesSessionKey: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
} & VoicePersona;

export type BindingsFile = {
	version: 1;
	users: Binding[];
};

export type RedactedBinding = {
	id: string;
	label: string;
	role: BindingRole;
	enabled: boolean;
	hermesApiBase: string;
	voiceKeySet: boolean;
	voiceKeyHint: string;
	hermesApiKeySet: boolean;
	hermesApiKeyHint: string;
	hermesSessionKeySet: boolean;
	hermesSessionKeyHint: string;
	createdAt: string;
	updatedAt: string;
} & VoicePersona;

export type BindingsLoad =
	| { status: 'ok'; file: BindingsFile }
	| { status: 'missing' }
	| { status: 'corrupt' }
	| { status: 'error' };

const DEFAULT_HERMES_BASE = 'http://127.0.0.1:8642';
const DEFAULT_SESSION_KEY = 'agent:main:voice';

function readEnvTrimmed(key: string): string | null {
	const fromProcess = process.env[key]?.trim();
	if (fromProcess) return fromProcess;
	const fromSnapshot = env[key]?.trim();
	return fromSnapshot || null;
}

export function isMultiUserMode(): boolean {
	return readEnvTrimmed('MULTI_USER') === '1';
}

export function resolveBindingsPath(): string {
	const fromEnv = readEnvTrimmed('BINDINGS_FILE');
	if (fromEnv) return path.resolve(fromEnv);
	return path.join(process.cwd(), 'data', 'bindings.json');
}

function hintLast4(value: string): string {
	const t = value.trim();
	if (t.length <= 4) return '••••';
	return `…${t.slice(-4)}`;
}

export function redactBinding(b: Binding): RedactedBinding {
	return {
		id: b.id,
		label: b.label,
		role: b.role,
		enabled: b.enabled,
		hermesApiBase: b.hermesApiBase,
		voiceKeySet: Boolean(b.voiceKey),
		voiceKeyHint: b.voiceKey ? hintLast4(b.voiceKey) : '',
		hermesApiKeySet: Boolean(b.hermesApiKey),
		hermesApiKeyHint: b.hermesApiKey ? hintLast4(b.hermesApiKey) : '',
		hermesSessionKeySet: Boolean(b.hermesSessionKey),
		hermesSessionKeyHint: b.hermesSessionKey ? hintLast4(b.hermesSessionKey) : '',
		createdAt: b.createdAt,
		updatedAt: b.updatedAt,
		// Persona fields are not secret — pass through verbatim.
		assistantName: b.assistantName,
		addressName: b.addressName,
		formalAddress: b.formalAddress,
		patientSilence: b.patientSilence,
		autoGreet: b.autoGreet,
		handsFreeSilenceMs: b.handsFreeSilenceMs,
		defaultTalkMode: b.defaultTalkMode,
		reviewConversationForMemory: b.reviewConversationForMemory
	};
}

/** The one conversion point from a Binding to the client-safe VoicePersona it carries. */
export function personaFromBinding(b: Binding): VoicePersona {
	return {
		assistantName: b.assistantName,
		addressName: b.addressName,
		formalAddress: b.formalAddress,
		patientSilence: b.patientSilence,
		autoGreet: b.autoGreet,
		handsFreeSilenceMs: b.handsFreeSilenceMs,
		defaultTalkMode: b.defaultTalkMode,
		reviewConversationForMemory: b.reviewConversationForMemory
	};
}

function normalizeBinding(raw: unknown): Binding | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const id = typeof o.id === 'string' ? o.id.trim() : '';
	const label = typeof o.label === 'string' ? o.label.trim() : '';
	const role = o.role === 'owner' || o.role === 'user' ? o.role : null;
	const voiceKey = typeof o.voiceKey === 'string' ? o.voiceKey.trim() : '';
	const hermesApiBase = typeof o.hermesApiBase === 'string' ? o.hermesApiBase.trim() : '';
	const hermesApiKey = typeof o.hermesApiKey === 'string' ? o.hermesApiKey.trim() : '';
	const hermesSessionKey =
		typeof o.hermesSessionKey === 'string' && o.hermesSessionKey.trim()
			? o.hermesSessionKey.trim()
			: DEFAULT_SESSION_KEY;
	const enabled = o.enabled !== false;
	const createdAt = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString();
	const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : createdAt;
	if (!id || !label || !role || !voiceKey || !hermesApiBase || !hermesApiKey) return null;
	return {
		id,
		label,
		role,
		voiceKey,
		hermesApiBase: hermesApiBase.replace(/\/$/, ''),
		hermesApiKey,
		hermesSessionKey,
		enabled,
		createdAt,
		updatedAt,
		// Persona fields are optional in the JSON row — absent fields normalize to
		// DEFAULT_PERSONA, reproducing today's exact behavior for every existing binding.
		// This MUST stay wired in: the owner PATCH route (`{ ...current, ...updates }`)
		// round-trips through this normalizer on every write, so dropping this spread
		// would silently erase persona on the next unrelated field edit.
		...normalizePersona(o)
	};
}

function parseBindingsFile(text: string): BindingsFile | 'corrupt' {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return 'corrupt';
	}
	if (!parsed || typeof parsed !== 'object') return 'corrupt';
	const version = (parsed as { version?: unknown }).version;
	const usersRaw = (parsed as { users?: unknown }).users;
	if (version !== 1 || !Array.isArray(usersRaw)) return 'corrupt';
	const users: Binding[] = [];
	for (const row of usersRaw) {
		const b = normalizeBinding(row);
		if (b) users.push(b);
	}
	// File had rows but none valid → corrupt (never treat as empty seedable store).
	if (usersRaw.length > 0 && users.length === 0) return 'corrupt';
	return { version: 1, users };
}

/**
 * Load bindings store.
 * - missing: file absent (safe to seed)
 * - corrupt / error: fail closed — never overwrite via seed
 */
export async function loadBindings(): Promise<BindingsLoad> {
	const filePath = resolveBindingsPath();
	try {
		const text = await readFile(filePath, 'utf8');
		const parsed = parseBindingsFile(text);
		if (parsed === 'corrupt') return { status: 'corrupt' };
		return { status: 'ok', file: parsed };
	} catch (err) {
		const code =
			err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
		if (code === 'ENOENT') return { status: 'missing' };
		console.error('bindings read failed');
		return { status: 'error' };
	}
}

/** @deprecated Prefer loadBindings(); missing → empty for callers that only seed. */
export async function readBindings(): Promise<BindingsFile> {
	const loaded = await loadBindings();
	if (loaded.status === 'ok') return loaded.file;
	return { version: 1, users: [] };
}

export type BindingsWriteResult =
	{ ok: true; path: string } | { ok: false; code: 'bindings_write_failed'; message?: string };

export async function writeBindingsAtomic(next: BindingsFile): Promise<BindingsWriteResult> {
	const filePath = resolveBindingsPath();
	const dir = path.dirname(filePath);
	const tmpPath = path.join(dir, `.bindings.${process.pid}.${Date.now()}.tmp`);

	try {
		await mkdir(dir, { recursive: true });
		const payload = JSON.stringify({ version: 1, users: next.users }, null, 2) + '\n';
		const handle = await open(tmpPath, 'w', 0o600);
		try {
			await handle.writeFile(payload, 'utf8');
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
			/* ignore */
		}
		const message = err instanceof Error ? err.message : 'write failed';
		console.error(`bindings write failed: ${message}`);
		return { ok: false, code: 'bindings_write_failed', message };
	}
}

export function findOwner(users: Binding[]): Binding | null {
	return users.find((u) => u.role === 'owner') ?? null;
}

export function voiceKeyTaken(users: Binding[], voiceKey: string, exceptId?: string): boolean {
	for (const u of users) {
		if (exceptId && u.id === exceptId) continue;
		if (safeEqualStr(u.voiceKey, voiceKey)) return true;
	}
	return false;
}

type EnvSeed = {
	voiceKey: string;
	hermesApiBase: string;
	hermesApiKey: string;
	hermesSessionKey: string;
};

/** Full seed required to import multi-user owner row. */
function readEnvSeed(): EnvSeed | null {
	const voiceKey = readEnvTrimmed('VOICE_URL_KEY');
	const hermesApiKey = readEnvTrimmed('HERMES_API_KEY');
	if (!voiceKey || !hermesApiKey) return null;
	const hermesApiBase =
		readEnvTrimmed('HERMES_API_BASE')?.replace(/\/$/, '') || DEFAULT_HERMES_BASE;
	const hermesSessionKey = readEnvTrimmed('HERMES_SESSION_KEY') || DEFAULT_SESSION_KEY;
	return { voiceKey, hermesApiBase, hermesApiKey, hermesSessionKey };
}

function ownerFromSeed(seed: EnvSeed): Binding {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		label: 'Owner',
		role: 'owner',
		voiceKey: seed.voiceKey,
		hermesApiBase: seed.hermesApiBase,
		hermesApiKey: seed.hermesApiKey,
		hermesSessionKey: seed.hermesSessionKey,
		enabled: true,
		createdAt: now,
		updatedAt: now,
		...DEFAULT_PERSONA
	};
}

/**
 * Ensure bindings store exists with at least the env-seeded owner when empty/missing.
 * Corrupt or unreadable stores fail closed — never overwrite with a re-seed.
 */
export async function ensureBindingsImported(): Promise<
	{ ok: true; file: BindingsFile } | { ok: false; code: string }
> {
	const loaded = await loadBindings();
	if (loaded.status === 'corrupt') return { ok: false, code: 'bindings_corrupt' };
	if (loaded.status === 'error') return { ok: false, code: 'bindings_read_failed' };
	if (loaded.status === 'ok' && loaded.file.users.length > 0) {
		return { ok: true, file: loaded.file };
	}

	const seed = readEnvSeed();
	if (!seed) return { ok: false, code: 'bindings_seed_incomplete' };

	// Re-check before write (create-if-absent).
	const again = await loadBindings();
	if (again.status === 'corrupt') return { ok: false, code: 'bindings_corrupt' };
	if (again.status === 'error') return { ok: false, code: 'bindings_read_failed' };
	if (again.status === 'ok' && again.file.users.length > 0) {
		return { ok: true, file: again.file };
	}

	const file: BindingsFile = { version: 1, users: [ownerFromSeed(seed)] };
	const written = await writeBindingsAtomic(file);
	if (!written.ok) return { ok: false, code: written.code };
	return { ok: true, file };
}

/**
 * Single-user synthetic binding from process.env-first env.
 * Auth only needs VOICE_URL_KEY (Hermes may be empty until configured).
 */
export function syntheticEnvBinding(): Binding | null {
	const voiceKey = readEnvTrimmed('VOICE_URL_KEY');
	if (!voiceKey) return null;
	const now = new Date().toISOString();
	return {
		id: 'env',
		label: 'Owner',
		role: 'owner',
		voiceKey,
		hermesApiBase: readEnvTrimmed('HERMES_API_BASE')?.replace(/\/$/, '') || DEFAULT_HERMES_BASE,
		hermesApiKey: readEnvTrimmed('HERMES_API_KEY') || '',
		hermesSessionKey: readEnvTrimmed('HERMES_SESSION_KEY') || DEFAULT_SESSION_KEY,
		enabled: true,
		createdAt: now,
		updatedAt: now,
		...DEFAULT_PERSONA
	};
}

/** Owner voice/Hermes → managed .env so disable MULTI_USER falls back safely. */
export async function syncOwnerToEnv(owner: Binding): Promise<EnvWriteResult> {
	const updates = {
		VOICE_URL_KEY: owner.voiceKey,
		HERMES_API_BASE: owner.hermesApiBase,
		HERMES_API_KEY: owner.hermesApiKey,
		HERMES_SESSION_KEY: owner.hermesSessionKey || DEFAULT_SESSION_KEY
	};
	const written = await writeEnvFileAtomic(updates);
	if (written.ok) applyEnvUpdatesInProcess(updates);
	return written;
}

export function defaultSessionKey(): string {
	return DEFAULT_SESSION_KEY;
}

export function defaultHermesBase(): string {
	return DEFAULT_HERMES_BASE;
}

export { safeEqualStr, readEnvTrimmed };
