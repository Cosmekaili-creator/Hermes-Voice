<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import VoicePicker from '$lib/components/settings/VoicePicker.svelte';
	import { getLocale, t, type Locale } from '$lib/i18n';
	import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';

	let { data } = $props();

	const locale = $derived((browser ? getLocale() : page.data.locale) as Locale);

	type PersonaFields = {
		assistantName: string;
		addressName: string;
		formalAddress: boolean;
		patientSilence: boolean;
		autoGreet: boolean;
		handsFreeSilenceMs: number;
		defaultTalkMode: 'ptt' | 'handsfree' | null;
		reviewConversationForMemory: boolean;
		voiceId: string | null;
	};

	type UserRow = {
		id: string;
		label: string;
		role: 'owner' | 'user';
		enabled: boolean;
		hermesApiBase: string;
		voiceKeyHint: string;
		hermesApiKeyHint: string;
		hermesSessionKeyHint: string;
	} & PersonaFields;

	let loading = $state(false);
	let saving = $state(false);
	let users = $state<UserRow[]>([]);
	let multiUser = $state(false);
	let message = $state('');
	let errorCode = $state('');

	let newLabel = $state('');
	let newVoiceKey = $state('');
	let newHermesBase = $state('http://127.0.0.1:8642');
	let newHermesKey = $state('');
	let newSessionKey = $state('agent:main:voice');

	let editId = $state<string | null>(null);
	let editLabel = $state('');
	let editVoiceKey = $state('');
	let editHermesBase = $state('');
	let editHermesKey = $state('');
	let editSessionKey = $state('');

	// Persona edit fields (chunk C). `editDefaultTalkMode` uses 'default' as the UI
	// spelling of `null` (no persisted preference) — converted back on save.
	let editShowPersona = $state(false);
	let editAssistantName = $state('');
	let editAddressName = $state('');
	let editFormalAddress = $state(false);
	let editPatientSilence = $state(false);
	let editAutoGreet = $state(false);
	let editHandsFreeSilenceMs = $state(1200);
	let editDefaultTalkMode = $state<'default' | 'ptt' | 'handsfree'>('default');
	let editReviewConversationForMemory = $state(false);
	let editVoiceId = $state<string | null>(null);
	/** Snapshot at edit-start — present-key-only diffing in saveEdit(), same discipline
	 * as the settings modal's SettingsForm (chunk A): an untouched persona field is
	 * never sent, so it can never silently overwrite a concurrent change. */
	let editPersonaInitial: PersonaFields | null = null;

	function errMsg(code: string | undefined): string {
		if (!code) return t('users.error.generic', locale);
		const key = `users.error.${code}` as Parameters<typeof t>[0];
		const translated = t(key, locale);
		return translated === key ? t('users.error.generic', locale) : translated;
	}

	async function refresh() {
		if (!data.authenticated) return;
		loading = true;
		errorCode = '';
		try {
			const res = await fetch('/api/owner/users', { credentials: 'same-origin' });
			const json = (await res.json().catch(() => null)) as null | {
				ok?: boolean;
				multiUser?: boolean;
				users?: UserRow[];
				code?: string;
			};
			if (!json) {
				errorCode = 'generic';
				return;
			}
			multiUser = Boolean(json.multiUser);
			users = json.users ?? [];
			if (!json.ok && json.code) errorCode = json.code;
		} finally {
			loading = false;
		}
	}

	async function enableMultiUser() {
		saving = true;
		message = '';
		errorCode = '';
		try {
			const res = await fetch('/api/owner/multi-user/enable', {
				method: 'POST',
				credentials: 'same-origin'
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			message = t('users.enabled', locale);
			await refresh();
		} finally {
			saving = false;
		}
	}

	async function disableMultiUser() {
		if (!confirm(t('users.disableConfirm', locale))) return;
		saving = true;
		message = '';
		errorCode = '';
		try {
			const res = await fetch('/api/owner/multi-user/disable', {
				method: 'POST',
				credentials: 'same-origin'
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			message = t('users.disabled', locale);
			await refresh();
		} finally {
			saving = false;
		}
	}

	function generateKey(): string {
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	async function addUser() {
		saving = true;
		message = '';
		errorCode = '';
		try {
			const res = await fetch('/api/owner/users', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label: newLabel,
					voiceKey: newVoiceKey,
					hermesApiBase: newHermesBase,
					hermesApiKey: newHermesKey,
					hermesSessionKey: newSessionKey
				})
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			newLabel = '';
			newVoiceKey = '';
			newHermesKey = '';
			newSessionKey = 'agent:main:voice';
			message = t('users.added', locale);
			await refresh();
		} finally {
			saving = false;
		}
	}

	function startEdit(u: UserRow) {
		editId = u.id;
		editLabel = u.label;
		editVoiceKey = '';
		editHermesBase = u.hermesApiBase;
		editHermesKey = '';
		editSessionKey = '';

		editShowPersona = false;
		editAssistantName = u.assistantName;
		editAddressName = u.addressName;
		editFormalAddress = u.formalAddress;
		editPatientSilence = u.patientSilence;
		editAutoGreet = u.autoGreet;
		editHandsFreeSilenceMs = u.handsFreeSilenceMs;
		editDefaultTalkMode = u.defaultTalkMode ?? 'default';
		editReviewConversationForMemory = u.reviewConversationForMemory;
		editVoiceId = u.voiceId;
		editPersonaInitial = {
			assistantName: u.assistantName,
			addressName: u.addressName,
			formalAddress: u.formalAddress,
			patientSilence: u.patientSilence,
			autoGreet: u.autoGreet,
			handsFreeSilenceMs: u.handsFreeSilenceMs,
			defaultTalkMode: u.defaultTalkMode,
			reviewConversationForMemory: u.reviewConversationForMemory,
			voiceId: u.voiceId
		};
	}

	async function saveEdit() {
		if (!editId) return;
		saving = true;
		message = '';
		errorCode = '';
		try {
			const body: Record<string, unknown> = {
				label: editLabel,
				hermesApiBase: editHermesBase
			};
			if (editVoiceKey) body.voiceKey = editVoiceKey;
			if (editHermesKey) body.hermesApiKey = editHermesKey;
			if (editSessionKey) body.hermesSessionKey = editSessionKey;

			// Persona: only fields that actually changed since edit-start are sent (present-
			// key discipline) — the PATCH route folds these in via mergePersonaPatch(), which
			// leaves every unsent field exactly as it was.
			if (editPersonaInitial) {
				if (editAssistantName !== editPersonaInitial.assistantName) {
					body.assistantName = editAssistantName;
				}
				if (editAddressName !== editPersonaInitial.addressName) {
					body.addressName = editAddressName;
				}
				if (editFormalAddress !== editPersonaInitial.formalAddress) {
					body.formalAddress = editFormalAddress;
				}
				if (editPatientSilence !== editPersonaInitial.patientSilence) {
					body.patientSilence = editPatientSilence;
				}
				if (editAutoGreet !== editPersonaInitial.autoGreet) {
					body.autoGreet = editAutoGreet;
				}
				if (editHandsFreeSilenceMs !== editPersonaInitial.handsFreeSilenceMs) {
					body.handsFreeSilenceMs = editHandsFreeSilenceMs;
				}
				const nextTalkMode = editDefaultTalkMode === 'default' ? null : editDefaultTalkMode;
				if (nextTalkMode !== editPersonaInitial.defaultTalkMode) {
					body.defaultTalkMode = nextTalkMode;
				}
				if (editReviewConversationForMemory !== editPersonaInitial.reviewConversationForMemory) {
					body.reviewConversationForMemory = editReviewConversationForMemory;
				}
				if (editVoiceId !== editPersonaInitial.voiceId) {
					body.voiceId = editVoiceId;
				}
			}

			const res = await fetch(`/api/owner/users/${editId}`, {
				method: 'PATCH',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			editId = null;
			editPersonaInitial = null;
			message = t('users.saved', locale);
			await refresh();
		} finally {
			saving = false;
		}
	}

	async function toggleEnabled(u: UserRow) {
		saving = true;
		errorCode = '';
		try {
			const res = await fetch(`/api/owner/users/${u.id}`, {
				method: 'PATCH',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !u.enabled })
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			await refresh();
		} finally {
			saving = false;
		}
	}

	async function removeUser(u: UserRow) {
		if (!confirm(t('users.deleteConfirm', locale))) return;
		saving = true;
		errorCode = '';
		try {
			const res = await fetch(`/api/owner/users/${u.id}`, {
				method: 'DELETE',
				credentials: 'same-origin'
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			await refresh();
		} finally {
			saving = false;
		}
	}

	async function probeUser(u: UserRow) {
		saving = true;
		message = '';
		errorCode = '';
		try {
			const res = await fetch(`/api/owner/users/${u.id}/probe`, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			const json = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (!json?.ok) {
				errorCode = json?.code || 'generic';
				return;
			}
			message = t('users.probeOk', locale);
		} finally {
			saving = false;
		}
	}

	onMount(() => {
		if (data.authenticated) void refresh();
	});
</script>

<div class="gate">
	<div class="glow" aria-hidden="true"></div>
	<div class="locale-corner"><LocaleSwitch /></div>

	<div class="panel">
		<p class="brand">{t('wizard.brand', locale)}</p>
		<h1>{t('users.title', locale)}</h1>

		{#if !data.authenticated}
			<p class="body">{t('users.needAuth', locale)}</p>
			<a class="link" href={resolve('/')}>{t('wizard.openLounge', locale)}</a>
		{:else}
			<p class="body">{t('users.intro', locale)}</p>

			<div class="nav">
				<a class="link" href={resolve('/owner/health')}>{t('users.linkHealth', locale)}</a>
				<a class="link" href={resolve('/setup')}>{t('health.backSetup', locale)}</a>
			</div>

			{#if errorCode}
				<p class="err" role="alert">{errMsg(errorCode)}</p>
			{/if}
			{#if message}
				<p class="okmsg">{message}</p>
			{/if}

			{#if !multiUser}
				<p class="body">{t('users.singleMode', locale)}</p>
				<button type="button" class="btn" disabled={saving} onclick={enableMultiUser}>
					{t('users.enable', locale)}
				</button>
			{:else}
				<ul class="checks">
					{#each users as u (u.id)}
						<li class="user-row">
							<div class="meta">
								<strong>{u.label}</strong>
								<span class="muted"
									>{u.role} · {u.enabled
										? t('users.enabledLabel', locale)
										: t('users.disabledLabel', locale)} · {u.hermesApiBase}</span
								>
								<span class="muted"
									>{t('users.voiceHint', locale)}
									{u.voiceKeyHint} · {t('users.keyHint', locale)}
									{u.hermesApiKeyHint}</span
								>
							</div>
							<div class="row-actions">
								<button
									type="button"
									class="btn ghost"
									disabled={saving}
									onclick={() => startEdit(u)}>{t('users.edit', locale)}</button
								>
								<button
									type="button"
									class="btn ghost"
									disabled={saving}
									onclick={() => probeUser(u)}>{t('users.probe', locale)}</button
								>
								<button
									type="button"
									class="btn ghost"
									disabled={saving}
									onclick={() => toggleEnabled(u)}
									>{u.enabled ? t('users.disable', locale) : t('users.enableRow', locale)}</button
								>
								{#if u.role !== 'owner'}
									<button
										type="button"
										class="btn ghost"
										disabled={saving}
										onclick={() => removeUser(u)}>{t('users.delete', locale)}</button
									>
								{/if}
							</div>

							{#if editId === u.id}
								<div class="form">
									<label>
										<span>{t('users.label', locale)}</span>
										<input bind:value={editLabel} autocomplete="off" />
									</label>
									<label>
										<span>{t('users.voiceKey', locale)}</span>
										<input
											bind:value={editVoiceKey}
											placeholder={t('users.blankKeep', locale)}
											autocomplete="off"
										/>
									</label>
									<label>
										<span>{t('wizard.hermesBaseLabel', locale)}</span>
										<input bind:value={editHermesBase} autocomplete="off" />
									</label>
									<label>
										<span>{t('wizard.hermesKeyLabel', locale)}</span>
										<input
											bind:value={editHermesKey}
											placeholder={t('users.blankKeep', locale)}
											autocomplete="off"
										/>
									</label>
									<label>
										<span>{t('wizard.hermesSessionLabel', locale)}</span>
										<input
											bind:value={editSessionKey}
											placeholder={u.hermesSessionKeyHint || t('users.blankKeep', locale)}
											autocomplete="off"
										/>
									</label>

									<button
										type="button"
										class="btn ghost persona-toggle"
										onclick={() => (editShowPersona = !editShowPersona)}
									>
										{editShowPersona ? '▾' : '▸'}
										{t('users.persona.toggle', locale)}
									</button>

									{#if editShowPersona}
										<fieldset class="persona-fieldset">
											<legend>{t('users.persona.toggle', locale)}</legend>
											<label>
												<span>{t('users.persona.assistantName', locale)}</span>
												<input bind:value={editAssistantName} autocomplete="off" />
											</label>
											<label>
												<span>{t('users.persona.addressName', locale)}</span>
												<input bind:value={editAddressName} autocomplete="off" />
											</label>
											<label class="checkbox">
												<input type="checkbox" bind:checked={editFormalAddress} />
												<span>{t('users.persona.formalAddress', locale)}</span>
											</label>
											<label class="checkbox">
												<input type="checkbox" bind:checked={editPatientSilence} />
												<span>{t('users.persona.patientSilence', locale)}</span>
											</label>
											<label class="checkbox">
												<input type="checkbox" bind:checked={editAutoGreet} />
												<span>{t('users.persona.autoGreet', locale)}</span>
											</label>
											<label>
												<span>{t('users.persona.handsFreeSilenceMs', locale)}</span>
												<input
													type="number"
													min="400"
													max="15000"
													step="50"
													bind:value={editHandsFreeSilenceMs}
												/>
												<span class="field-hint"
													>{t('users.persona.handsFreeSilenceHint', locale)}</span
												>
											</label>
											<label>
												<span>{t('users.persona.defaultTalkMode', locale)}</span>
												<select bind:value={editDefaultTalkMode}>
													<option value="default"
														>{t('users.persona.talkModeDefault', locale)}</option
													>
													<option value="ptt">{t('mode.ptt', locale)}</option>
													<option value="handsfree">{t('mode.handsfree', locale)}</option>
												</select>
											</label>
											<label class="checkbox">
												<input type="checkbox" bind:checked={editReviewConversationForMemory} />
												<span>{t('users.persona.reviewConversationForMemory', locale)}</span>
											</label>
											<p class="field-hint field-hint--warn">
												{t('users.persona.reviewConversationHint', locale)}
											</p>
											<VoicePicker
												provider={data.provider}
												voiceId={editVoiceId}
												onSelect={(id) => (editVoiceId = id)}
												disabled={saving}
											/>
										</fieldset>
									{/if}

									<div class="row-actions">
										<button type="button" class="btn" disabled={saving} onclick={saveEdit}
											>{t('users.save', locale)}</button
										>
										<button
											type="button"
											class="btn ghost"
											onclick={() => {
												editId = null;
												editPersonaInitial = null;
											}}>{t('wizard.back', locale)}</button
										>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				{#if loading}
					<p class="body">{t('health.checking', locale)}</p>
				{/if}

				<h2>{t('users.addTitle', locale)}</h2>
				<div class="form">
					<label>
						<span>{t('users.label', locale)}</span>
						<input bind:value={newLabel} autocomplete="off" />
					</label>
					<label>
						<span>{t('users.voiceKey', locale)}</span>
						<div class="inline">
							<input bind:value={newVoiceKey} autocomplete="off" />
							<button type="button" class="btn ghost" onclick={() => (newVoiceKey = generateKey())}
								>{t('wizard.generateKey', locale)}</button
							>
						</div>
					</label>
					<label>
						<span>{t('wizard.hermesBaseLabel', locale)}</span>
						<input bind:value={newHermesBase} autocomplete="off" />
					</label>
					<label>
						<span>{t('wizard.hermesKeyLabel', locale)}</span>
						<input bind:value={newHermesKey} autocomplete="off" />
					</label>
					<label>
						<span>{t('wizard.hermesSessionLabel', locale)}</span>
						<input bind:value={newSessionKey} autocomplete="off" />
					</label>
					<button type="button" class="btn" disabled={saving} onclick={addUser}
						>{t('users.add', locale)}</button
					>
				</div>

				<button type="button" class="btn ghost danger" disabled={saving} onclick={disableMultiUser}>
					{t('users.disableMode', locale)}
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.gate {
		--ink: #e8f7f8;
		--muted: #8eb8bc;
		--accent: #5ee7ff;

		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		overflow: hidden;
		display: grid;
		place-items: center;
		color: var(--ink);
		font-family: 'DM Sans', system-ui, sans-serif;
		background: radial-gradient(ellipse at 50% 45%, #0d3a40 0%, #061618 42%, #030a0c 100%);
		padding: 1.25rem;
	}

	.glow {
		position: absolute;
		inset: -10%;
		z-index: 0;
		pointer-events: none;
		background:
			radial-gradient(circle at 50% 46%, rgba(94, 231, 255, 0.1), transparent 42%),
			radial-gradient(circle at 30% 70%, rgba(202, 253, 255, 0.04), transparent 35%);
		animation: field-breathe 8s ease-in-out infinite;
		filter: blur(2px);
	}

	@keyframes field-breathe {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.7;
		}
		50% {
			transform: scale(1.05);
			opacity: 0.95;
		}
	}

	.locale-corner {
		position: absolute;
		z-index: 2;
		top: max(0.85rem, env(safe-area-inset-top));
		right: max(0.85rem, env(safe-area-inset-right));
	}

	.panel {
		position: relative;
		z-index: 1;
		width: min(36rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.brand {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.2rem, 3.5vw, 1.6rem);
		font-weight: 500;
		letter-spacing: 0.22em;
		text-indent: 0.22em;
		color: rgba(232, 247, 248, 0.45);
		text-align: center;
	}

	h1,
	h2 {
		margin: 0;
		font-weight: 500;
		text-align: center;
	}

	h1 {
		font-size: clamp(1.2rem, 3.2vw, 1.55rem);
	}

	h2 {
		font-size: 1.05rem;
		margin-top: 0.5rem;
	}

	.body {
		margin: 0;
		color: var(--muted);
		text-align: center;
		line-height: 1.45;
	}

	.nav {
		display: flex;
		gap: 1rem;
		justify-content: center;
	}

	.checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.user-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid rgba(202, 253, 255, 0.12);
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.muted {
		color: var(--muted);
		font-size: 0.88rem;
	}

	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.9rem;
		color: var(--muted);
	}

	input {
		min-height: 2.3rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: rgba(3, 10, 12, 0.45);
		color: var(--ink);
		font: inherit;
	}

	.inline {
		display: flex;
		gap: 0.45rem;
		align-items: center;
	}

	select {
		min-height: 2.3rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: rgba(3, 10, 12, 0.45);
		color: var(--ink);
		font: inherit;
	}

	.persona-toggle {
		align-self: flex-start;
		margin-top: 0.2rem;
	}

	.persona-fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		margin: 0.4rem 0 0;
		padding: 0.75rem;
		border: 1px solid rgba(202, 253, 255, 0.18);
		border-radius: 0.6rem;
	}

	.persona-fieldset legend {
		padding: 0 0.35rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.field-hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
		line-height: 1.4;
	}

	.field-hint--warn {
		color: #ffd98a;
	}

	.inline input {
		flex: 1;
	}

	.btn {
		min-height: 2.3rem;
		padding: 0.4rem 0.9rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(94, 231, 255, 0.45);
		background: rgba(94, 231, 255, 0.16);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}

	.btn.ghost {
		background: transparent;
		border-color: rgba(202, 253, 255, 0.28);
	}

	.btn.danger {
		border-color: rgba(255, 143, 143, 0.45);
		color: #ffb4b4;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.link {
		color: var(--accent);
		text-decoration: none;
		font-size: 0.92rem;
	}

	.err {
		margin: 0;
		color: #ff8f8f;
		text-align: center;
	}

	.okmsg {
		margin: 0;
		color: #7dffb2;
		text-align: center;
	}
</style>
