<script lang="ts">
	import { resolve } from '$app/paths';
	import { getLocale, t } from '$lib/i18n';
	import type { SettingsForm } from './settingsForm.svelte';
	import VoicePicker from './VoicePicker.svelte';

	let { form, onReconnect }: { form: SettingsForm; onReconnect?: () => void } = $props();

	let testing = $state(false);
	let testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	let testCode = $state('');

	function testErrorMessage(code: string): string {
		const key = `wizard.error.${code}` as Parameters<typeof t>[0];
		const msg = t(key, getLocale());
		return msg === key ? t('wizard.error.generic', getLocale()) : msg;
	}

	async function testProvider() {
		testing = true;
		testStatus = 'idle';
		testCode = '';
		try {
			const url =
				form.voiceProvider === 'openai' ? '/api/setup/test/openai' : '/api/setup/test/xai';
			const body =
				form.voiceProvider === 'openai'
					? { openaiApiKey: form.openaiApiKey || undefined }
					: { xaiApiKey: form.xaiApiKey || undefined };
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify(body)
			});
			const data = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
			if (data.ok === true) {
				testStatus = 'ok';
			} else {
				testStatus = 'fail';
				testCode = data.code || 'generic';
			}
		} catch {
			testStatus = 'fail';
			testCode = 'generic';
		} finally {
			testing = false;
		}
	}
</script>

<!-- New field component, deliberately not extracted from SetupWizard.svelte (see the
     chunk A note in the plan) — provider step counterpart: SetupWizard.svelte's
     "provider"/"xai"/"openai" steps. Markup duplication is an accepted tradeoff. -->
<div class="fields">
	<label class="field">
		<span>{t('wizard.providerLabel', getLocale())}</span>
		<select
			value={form.voiceProvider}
			onchange={(e) => {
				const next = (e.currentTarget as HTMLSelectElement).value as 'xai' | 'openai';
				form.voiceProvider = next;
				// m2: a voiceId picked under the previous provider (e.g. an xAI voice_id)
				// must never ride along into the other provider's env key on save.
				form.voiceId = null;
			}}
		>
			<option value="xai">{t('wizard.providerXai', getLocale())}</option>
			<option value="openai">{t('wizard.providerOpenai', getLocale())}</option>
		</select>
	</label>

	{#if form.voiceProvider === 'xai'}
		<label class="field">
			<span>{t('wizard.xaiKeyLabel', getLocale())}</span>
			<input
				type="password"
				bind:value={form.xaiApiKey}
				autocomplete="off"
				placeholder={form.xaiApiKeyHint.fieldSet
					? t('settings.blankKeepHint', getLocale()).replace('{hint}', form.xaiApiKeyHint.fieldHint)
					: ''}
			/>
		</label>
	{:else}
		<label class="field">
			<span>{t('wizard.openaiKeyLabel', getLocale())}</span>
			<input
				type="password"
				bind:value={form.openaiApiKey}
				autocomplete="off"
				placeholder={form.openaiApiKeyHint.fieldSet
					? t('settings.blankKeepHint', getLocale()).replace(
							'{hint}',
							form.openaiApiKeyHint.fieldHint
						)
					: ''}
			/>
		</label>
	{/if}

	<div class="row-actions">
		<button type="button" class="btn ghost" disabled={testing} onclick={testProvider}>
			{testing ? t('wizard.testing', getLocale()) : t('wizard.test', getLocale())}
		</button>
		{#if testStatus === 'ok'}
			<span class="ok">{t('wizard.testOk', getLocale())}</span>
		{:else if testStatus === 'fail'}
			<span class="err">{t('wizard.testFailed', getLocale())} — {testErrorMessage(testCode)}</span>
		{/if}
	</div>

	{#if form.multiUser}
		<!-- M2 fix: GET /api/settings/current prefills this section's voiceId from the
		     owner's OWN binding row, but saving it here would write the shared
		     XAI_VOICE/OPENAI_VOICE env fallback — which also applies to any OTHER
		     binding whose own voiceId is null (e.g. a second user), silently changing
		     their assistant's voice with no warning to them or the owner. Hiding the
		     picker (rather than relabeling it as a "shared fallback") is the safer fix
		     per the settings/voice-choice plan's QC pass. Per-user voice stays in
		     /owner/users → VoicePicker there, which writes the per-binding voiceId. -->
		<p class="voice-picker__hint">
			{t('settings.voice.multiUserNotice', getLocale())}
			<a class="link" href={resolve('/owner/users')}>{t('users.title', getLocale())}</a>.
		</p>
	{:else}
		<VoicePicker
			provider={form.voiceProvider}
			voiceId={form.voiceId}
			onSelect={(id) => (form.voiceId = id)}
			xaiApiKeyOverride={form.xaiApiKey}
			disabled={form.busy}
			saved={form.saved}
			{onReconnect}
		/>
	{/if}
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.9rem;
		color: var(--muted, #8eb8bc);
	}

	.field input,
	.field select {
		min-height: 2.3rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: rgba(3, 10, 12, 0.45);
		color: var(--ink, #e8f7f8);
		font: inherit;
	}

	.voice-picker__hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted, #8eb8bc);
		line-height: 1.4;
	}

	.link {
		color: #5ee7ff;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.btn.ghost {
		min-height: 2.1rem;
		padding: 0.35rem 0.8rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: transparent;
		color: var(--ink, #e8f7f8);
		font: inherit;
		cursor: pointer;
	}

	.btn.ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ok {
		color: #7dffb2;
		font-size: 0.85rem;
	}

	.err {
		color: #ff8f8f;
		font-size: 0.85rem;
	}
</style>
