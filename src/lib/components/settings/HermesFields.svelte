<script lang="ts">
	import { getLocale, t } from '$lib/i18n';
	import type { SettingsForm } from './settingsForm.svelte';

	let { form }: { form: SettingsForm } = $props();

	let testing = $state(false);
	let testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	let testCode = $state('');

	function testErrorMessage(code: string): string {
		const key = `wizard.error.${code}` as Parameters<typeof t>[0];
		const msg = t(key, getLocale());
		return msg === key ? t('wizard.error.generic', getLocale()) : msg;
	}

	async function testHermes() {
		testing = true;
		testStatus = 'idle';
		testCode = '';
		try {
			const res = await fetch('/api/setup/test/hermes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					hermesApiBase: form.hermesApiBase || undefined,
					hermesApiKey: form.hermesApiKey || undefined
				})
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
     chunk A note in the plan) — Hermes step counterpart: SetupWizard.svelte's "hermes"
     step. Markup duplication is an accepted tradeoff. -->
<div class="fields">
	<label class="field">
		<span>{t('wizard.hermesBaseLabel', getLocale())}</span>
		<input bind:value={form.hermesApiBase} autocomplete="off" />
	</label>

	<label class="field">
		<span>{t('wizard.hermesKeyLabel', getLocale())}</span>
		<input
			type="password"
			bind:value={form.hermesApiKey}
			autocomplete="off"
			placeholder={form.hermesApiKeyHint.fieldSet
				? t('settings.blankKeepHint', getLocale()).replace(
						'{hint}',
						form.hermesApiKeyHint.fieldHint
					)
				: ''}
		/>
	</label>

	<label class="field">
		<span>{t('wizard.hermesSessionLabel', getLocale())}</span>
		<input
			bind:value={form.hermesSessionKey}
			autocomplete="off"
			placeholder={form.hermesSessionKeyHint.fieldSet
				? t('settings.blankKeepHint', getLocale()).replace(
						'{hint}',
						form.hermesSessionKeyHint.fieldHint
					)
				: ''}
		/>
	</label>

	<p class="hint">{t('wizard.hermesHint', getLocale())}</p>

	<div class="row-actions">
		<button type="button" class="btn ghost" disabled={testing} onclick={testHermes}>
			{testing ? t('wizard.testing', getLocale()) : t('wizard.test', getLocale())}
		</button>
		{#if testStatus === 'ok'}
			<span class="ok">{t('wizard.testOk', getLocale())}</span>
		{:else if testStatus === 'fail'}
			<span class="err">{t('wizard.testFailed', getLocale())} — {testErrorMessage(testCode)}</span>
		{/if}
	</div>
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

	.field input {
		min-height: 2.3rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: rgba(3, 10, 12, 0.45);
		color: var(--ink, #e8f7f8);
		font: inherit;
	}

	.hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted, #8eb8bc);
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
