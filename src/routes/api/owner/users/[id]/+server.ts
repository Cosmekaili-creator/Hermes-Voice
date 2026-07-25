import { json, type RequestHandler } from '@sveltejs/kit';
import { clearSessionCookie, requireOwner } from '$lib/server/auth';
import {
	ensureBindingsImported,
	findOwner,
	isMultiUserMode,
	redactBinding,
	syncOwnerToEnv,
	voiceKeyTaken,
	writeBindingsAtomic,
	type Binding
} from '$lib/server/bindings.server';
import { validateHermesApiBase } from '$lib/server/setupProbes.server';

function strField(body: unknown, key: string): string | null {
	if (!body || typeof body !== 'object') return null;
	const v = (body as Record<string, unknown>)[key];
	return typeof v === 'string' ? v.trim() : null;
}

function boolField(body: unknown, key: string): boolean | null {
	if (!body || typeof body !== 'object') return null;
	const v = (body as Record<string, unknown>)[key];
	if (typeof v === 'boolean') return v;
	return null;
}

async function loadUsers() {
	if (!isMultiUserMode()) {
		return { error: json({ ok: false, code: 'multi_user_disabled' }, { status: 400 }) };
	}
	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return { error: json({ ok: false, code: imported.code }, { status: 503 }) };
	}
	return { file: imported.file };
}

export const PATCH: RequestHandler = async (event) => {
	await requireOwner(event);
	const loaded = await loadUsers();
	if ('error' in loaded && loaded.error) return loaded.error;

	const id = event.params.id;
	const body = await event.request.json().catch(() => ({}));
	const users = loaded.file!.users;
	const idx = users.findIndex((u) => u.id === id);
	if (idx < 0) {
		return json({ ok: false, code: 'not_found' }, { status: 404 });
	}

	const current = users[idx]!;
	const label = strField(body, 'label');
	const voiceKey = strField(body, 'voiceKey');
	const hermesApiBase = strField(body, 'hermesApiBase');
	const hermesApiKey = strField(body, 'hermesApiKey');
	const hermesSessionKey = strField(body, 'hermesSessionKey');
	const roleRaw = strField(body, 'role');
	const enabled = boolField(body, 'enabled');

	let nextRole = current.role;
	if (roleRaw === 'owner' || roleRaw === 'user') {
		if (roleRaw === 'owner' && current.role !== 'owner') {
			return json({ ok: false, code: 'second_owner' }, { status: 400 });
		}
		if (roleRaw === 'user' && current.role === 'owner') {
			const owners = users.filter((u) => u.role === 'owner');
			if (owners.length <= 1) {
				return json({ ok: false, code: 'last_owner' }, { status: 400 });
			}
		}
		nextRole = roleRaw;
	}

	if (enabled === false && current.role === 'owner') {
		const owners = users.filter((u) => u.role === 'owner' && u.enabled);
		if (owners.length <= 1) {
			return json({ ok: false, code: 'last_owner' }, { status: 400 });
		}
	}

	let nextBase = current.hermesApiBase;
	if (hermesApiBase) {
		const baseCheck = validateHermesApiBase(hermesApiBase);
		if (!baseCheck.ok) {
			return json({ ok: false, code: baseCheck.code }, { status: 400 });
		}
		nextBase = baseCheck.base;
	}

	if (voiceKey && voiceKeyTaken(users, voiceKey, current.id)) {
		return json({ ok: false, code: 'voice_key_taken' }, { status: 400 });
	}

	const updated: Binding = {
		...current,
		label: label || current.label,
		role: nextRole,
		voiceKey: voiceKey || current.voiceKey,
		hermesApiBase: nextBase,
		hermesApiKey: hermesApiKey || current.hermesApiKey,
		hermesSessionKey: hermesSessionKey || current.hermesSessionKey,
		enabled: enabled === null ? current.enabled : enabled,
		updatedAt: new Date().toISOString()
	};

	const nextUsers = users.map((u, i) => (i === idx ? updated : u));
	const written = await writeBindingsAtomic({ version: 1, users: nextUsers });
	if (!written.ok) {
		return json({ ok: false, code: written.code }, { status: 500 });
	}

	if (updated.role === 'owner') {
		const envSync = await syncOwnerToEnv(updated);
		if (!envSync.ok) {
			return json({ ok: false, code: 'env_write_failed' }, { status: 500 });
		}
		if (voiceKey && voiceKey !== current.voiceKey) {
			clearSessionCookie(event.cookies);
		}
	}

	return json({ ok: true, user: redactBinding(updated) });
};

export const DELETE: RequestHandler = async (event) => {
	await requireOwner(event);
	const loaded = await loadUsers();
	if ('error' in loaded && loaded.error) return loaded.error;

	const id = event.params.id;
	const users = loaded.file!.users;
	const target = users.find((u) => u.id === id);
	if (!target) {
		return json({ ok: false, code: 'not_found' }, { status: 404 });
	}

	if (target.role === 'owner') {
		const owners = users.filter((u) => u.role === 'owner');
		if (owners.length <= 1) {
			return json({ ok: false, code: 'last_owner' }, { status: 400 });
		}
	}

	const nextUsers = users.filter((u) => u.id !== id);
	// Keep exactly one owner invariant after delete
	if (!findOwner(nextUsers)) {
		return json({ ok: false, code: 'last_owner' }, { status: 400 });
	}

	const written = await writeBindingsAtomic({ version: 1, users: nextUsers });
	if (!written.ok) {
		return json({ ok: false, code: written.code }, { status: 500 });
	}

	return json({ ok: true });
};
