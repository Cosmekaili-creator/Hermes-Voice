import { json, type RequestHandler } from '@sveltejs/kit';
import { normalizeVoiceId } from '$lib/persona/types';
import { requireOwner } from '$lib/server/auth';
import {
	ensureBindingsImported,
	findOwner,
	isMultiUserMode,
	normalizeSessionKey,
	writeBindingsAtomic,
	type Binding
} from '$lib/server/bindings.server';
import {
	applyEnvUpdatesInProcess,
	writeEnvFileAtomic,
	type EnvUpdates
} from '$lib/server/envFile.server';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';
import { requireSetupOrOwner } from '$lib/server/setupMode.server';
import { validateHermesApiBase } from '$lib/server/setupProbes.server';
import { pickPresentFields } from '$lib/server/settingsFields.server';

// Cross-referenced with MANAGED_ENV_KEYS' definition-site comment in envFile.server.ts —
// the two lists must stay in sync.
const SECTION_ALLOWLIST = {
	provider: ['VOICE_PROVIDER', 'XAI_API_KEY', 'OPENAI_API_KEY', 'XAI_VOICE', 'OPENAI_VOICE'],
	hermes: ['HERMES_API_BASE', 'HERMES_API_KEY', 'HERMES_SESSION_KEY']
} as const;

type Section = keyof typeof SECTION_ALLOWLIST;

function isSection(value: unknown): value is Section {
	return value === 'provider' || value === 'hermes';
}

/**
 * Owner-only settings save — the core safety-critical route of the settings feature.
 *
 * Present-key semantics only, no exceptions: a key absent from `fields` is never read,
 * never written, never falls back to any default (see `pickPresentFields`). This is the
 * entire fix for the original config-corruption bug that motivated this feature — do not
 * introduce any `x || existing() || 'default'`-shaped fallback chain anywhere in this
 * route, that pattern is exactly what caused it in `/api/setup/save`.
 *
 * Never writes `VOICE_URL_KEY`, `ORIGIN`, `SETUP_COMPLETE`, `SETUP_TOKEN`, `MULTI_USER`
 * under any circumstance — those remain exclusively editable via `/setup` (neither
 * SECTION_ALLOWLIST above contains them, so this is structurally impossible, not just
 * policy). This route also never writes `restartRequired: true` — it cannot touch
 * `ORIGIN`, and (as of chunk D1) everything else it can touch hot-applies.
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	enforceRateLimit(event, 'setupSave', RATE.setupSave.limit, RATE.setupSave.windowMs);

	const body = await event.request.json().catch(() => ({}));
	await requireSetupOrOwner(event, body);
	if (isMultiUserMode()) {
		await requireOwner(event, body);
	}

	const section =
		body && typeof body === 'object' ? (body as Record<string, unknown>).section : undefined;
	if (!isSection(section)) {
		return json({ ok: false, code: 'invalid_section' }, { status: 400 });
	}

	const rawFields =
		body && typeof body === 'object' ? (body as Record<string, unknown>).fields : undefined;
	const picked = pickPresentFields(rawFields, SECTION_ALLOWLIST[section]);
	if (!picked.ok) {
		return json({ ok: false, code: picked.code }, { status: 400 });
	}
	const fields = picked.fields;

	const updates: EnvUpdates = {};

	if ('VOICE_PROVIDER' in fields) {
		const v = fields.VOICE_PROVIDER!.trim().toLowerCase();
		if (v !== 'xai' && v !== 'openai') {
			return json({ ok: false, code: 'invalid_provider' }, { status: 400 });
		}
		updates.VOICE_PROVIDER = v;
	}
	if ('XAI_API_KEY' in fields) {
		updates.XAI_API_KEY = fields.XAI_API_KEY!.trim();
	}
	if ('OPENAI_API_KEY' in fields) {
		updates.OPENAI_API_KEY = fields.OPENAI_API_KEY!.trim();
	}
	if ('XAI_VOICE' in fields) {
		const v = normalizeVoiceId(fields.XAI_VOICE);
		if (!v) return json({ ok: false, code: 'invalid_voice_id' }, { status: 400 });
		updates.XAI_VOICE = v;
	}
	if ('OPENAI_VOICE' in fields) {
		const v = normalizeVoiceId(fields.OPENAI_VOICE);
		if (!v) return json({ ok: false, code: 'invalid_voice_id' }, { status: 400 });
		updates.OPENAI_VOICE = v;
	}

	let hermesBaseChecked: string | null = null;
	if ('HERMES_API_BASE' in fields) {
		const baseCheck = validateHermesApiBase(fields.HERMES_API_BASE!);
		if (!baseCheck.ok) return json({ ok: false, code: baseCheck.code }, { status: 400 });
		updates.HERMES_API_BASE = baseCheck.base;
		hermesBaseChecked = baseCheck.base;
	}
	if ('HERMES_API_KEY' in fields) {
		updates.HERMES_API_KEY = fields.HERMES_API_KEY!.trim();
	}
	let hermesSessionChecked: string | null = null;
	if ('HERMES_SESSION_KEY' in fields) {
		const sk = normalizeSessionKey(fields.HERMES_SESSION_KEY);
		if (!sk) return json({ ok: false, code: 'invalid_session_key' }, { status: 400 });
		updates.HERMES_SESSION_KEY = sk;
		hermesSessionChecked = sk;
	}

	// Multi-user owner sync: present-key intersection with {hermesApiBase, hermesApiKey,
	// hermesSessionKey} only — never a blanket copy of `fields`. Skip writeBindingsAtomic
	// entirely when the intersection is empty so an intended no-op "provider" section
	// save can never bump the owner row's updatedAt.
	let ownerSync: { ownerId: string; users: Binding[]; patch: Partial<Binding> } | null = null;
	if (isMultiUserMode()) {
		const ownerPatch: Partial<Binding> = {};
		if (hermesBaseChecked !== null) ownerPatch.hermesApiBase = hermesBaseChecked;
		if ('HERMES_API_KEY' in fields) ownerPatch.hermesApiKey = fields.HERMES_API_KEY!.trim();
		if (hermesSessionChecked !== null) ownerPatch.hermesSessionKey = hermesSessionChecked;

		if (Object.keys(ownerPatch).length > 0) {
			// Validate owner-exists before the .env write (mirrors /api/setup/save's
			// ordering rationale) so .env and bindings.json can't diverge on partial failure.
			const imported = await ensureBindingsImported();
			if (!imported.ok) {
				return json({ ok: false, code: imported.code }, { status: 503 });
			}
			const owner = findOwner(imported.file.users);
			if (!owner) {
				return json({ ok: false, code: 'bindings_no_owner' }, { status: 500 });
			}
			ownerSync = { ownerId: owner.id, users: imported.file.users, patch: ownerPatch };
		}
	}

	// Present-key semantics: an all-absent `fields` (nothing dirty) is a valid no-op —
	// zero writes, not an error. This is the direct proof the config-corruption bug is
	// fixed (see the plan's manual smoke step 2).
	if (Object.keys(updates).length === 0 && !ownerSync) {
		return json({ ok: true, restartRequired: false });
	}

	if (Object.keys(updates).length > 0) {
		const written = await writeEnvFileAtomic(updates);
		if (!written.ok) {
			return json({ ok: false, code: written.code }, { status: 500 });
		}
		applyEnvUpdatesInProcess(updates);
	}

	if (ownerSync) {
		const now = new Date().toISOString();
		const nextUsers = ownerSync.users.map((u) =>
			u.id === ownerSync!.ownerId ? { ...u, ...ownerSync!.patch, updatedAt: now } : u
		);
		const bindingsWritten = await writeBindingsAtomic({ version: 1, users: nextUsers });
		if (!bindingsWritten.ok) {
			return json({ ok: false, code: bindingsWritten.code }, { status: 500 });
		}
	}

	// This route can never write ORIGIN, and (as of chunk D1) everything else it can
	// touch hot-applies — always false, no exceptions.
	return json({ ok: true, restartRequired: false });
};
