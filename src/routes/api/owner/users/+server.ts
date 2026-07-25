import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireVoiceKey } from '$lib/server/auth';
import {
	defaultHermesBase,
	defaultSessionKey,
	ensureBindingsImported,
	isMultiUserMode,
	redactBinding,
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

export const GET: RequestHandler = async (event) => {
	if (isMultiUserMode()) {
		await requireOwner(event);
		const imported = await ensureBindingsImported();
		if (!imported.ok) {
			return json({ ok: false, multiUser: true, code: imported.code, users: [] }, { status: 503 });
		}
		return json({
			ok: true,
			multiUser: true,
			users: imported.file.users.map(redactBinding)
		});
	}

	await requireVoiceKey(event);
	return json({ ok: true, multiUser: false, users: [] });
};

export const POST: RequestHandler = async (event) => {
	await requireOwner(event);
	if (!isMultiUserMode()) {
		return json({ ok: false, code: 'multi_user_disabled' }, { status: 400 });
	}

	const body = await event.request.json().catch(() => ({}));
	const label = strField(body, 'label');
	const voiceKey = strField(body, 'voiceKey');
	const hermesApiBase = strField(body, 'hermesApiBase') || defaultHermesBase();
	const hermesApiKey = strField(body, 'hermesApiKey');
	const hermesSessionKey = strField(body, 'hermesSessionKey') || defaultSessionKey();
	const roleRaw = strField(body, 'role');

	if (!label) return json({ ok: false, code: 'missing_label' }, { status: 400 });
	if (!voiceKey) return json({ ok: false, code: 'missing_voice_key' }, { status: 400 });
	if (!hermesApiKey) return json({ ok: false, code: 'missing_hermes_key' }, { status: 400 });

	if (roleRaw === 'owner') {
		return json({ ok: false, code: 'second_owner' }, { status: 400 });
	}

	const baseCheck = validateHermesApiBase(hermesApiBase);
	if (!baseCheck.ok) {
		return json({ ok: false, code: baseCheck.code }, { status: 400 });
	}

	const imported = await ensureBindingsImported();
	if (!imported.ok) {
		return json({ ok: false, code: imported.code }, { status: 503 });
	}

	if (voiceKeyTaken(imported.file.users, voiceKey)) {
		return json({ ok: false, code: 'voice_key_taken' }, { status: 400 });
	}

	const now = new Date().toISOString();
	const user: Binding = {
		id: randomUUID(),
		label,
		role: 'user',
		voiceKey,
		hermesApiBase: baseCheck.base,
		hermesApiKey,
		hermesSessionKey,
		enabled: true,
		createdAt: now,
		updatedAt: now
	};

	const next = { version: 1 as const, users: [...imported.file.users, user] };
	const written = await writeBindingsAtomic(next);
	if (!written.ok) {
		return json({ ok: false, code: written.code }, { status: 500 });
	}

	return json({ ok: true, user: redactBinding(user) });
};
