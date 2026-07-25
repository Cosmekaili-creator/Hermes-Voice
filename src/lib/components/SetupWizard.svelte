<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getLocale, t, type Locale, type MessageKey } from '$lib/i18n';
	import LocaleSwitch from './LocaleSwitch.svelte';

	type Props = {
		rotation?: boolean;
	};

	let { rotation = false }: Props = $props();

	const locale = $derived((browser ? getLocale() : page.data.locale) as Locale);

	const steps = ['voice', 'xai', 'hermes', 'origin', 'save'] as const;
	type Step = (typeof steps)[number];

	let stepIndex = $state(0);
	let voiceUrlKey = $state('');
	let xaiApiKey = $state('');
	let hermesApiBase = $state('http://127.0.0.1:8642');
	let hermesApiKey = $state('');
	let hermesSessionKey = $state('agent:main:voice');
	let origin = $state('');
	let busy = $state(false);
	let testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	let testCode = $state('');
	let warnings = $state<string[]>([]);
	let saveError = $state('');
	let saved = $state(false);

	const step = $derived(steps[stepIndex] as Step);

	onMount(() => {
		if (!origin) origin = window.location.origin;
	});

	function errorMessage(code: string): string {
		const key = `wizard.error.${code}` as MessageKey;
		const msg = t(key, locale);
		if (msg === key) return t('wizard.error.generic', locale);
		return msg;
	}

	function generateKey() {
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		voiceUrlKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	async function postJson(url: string, body: Record<string, unknown>) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		});
		const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		return { res, data };
	}

	async function testXai() {
		busy = true;
		testStatus = 'idle';
		testCode = '';
		try {
			const { data } = await postJson('/api/setup/test/xai', {
				xaiApiKey: xaiApiKey || undefined
			});
			if (data.ok === true) {
				testStatus = 'ok';
			} else {
				testStatus = 'fail';
				testCode = typeof data.code === 'string' ? data.code : 'mint_failed';
			}
		} catch {
			testStatus = 'fail';
			testCode = 'mint_failed';
		} finally {
			busy = false;
		}
	}

	async function testHermes() {
		busy = true;
		testStatus = 'idle';
		testCode = '';
		try {
			const { data } = await postJson('/api/setup/test/hermes', {
				hermesApiBase: hermesApiBase || undefined,
				hermesApiKey: hermesApiKey || undefined
			});
			if (data.ok === true) {
				testStatus = 'ok';
			} else {
				testStatus = 'fail';
				testCode = typeof data.code === 'string' ? data.code : 'hermes_unreachable';
			}
		} catch {
			testStatus = 'fail';
			testCode = 'hermes_unreachable';
		} finally {
			busy = false;
		}
	}

	async function testOrigin() {
		busy = true;
		testStatus = 'idle';
		testCode = '';
		warnings = [];
		try {
			const { data } = await postJson('/api/setup/test/origin', {
				origin: origin || undefined
			});
			warnings = Array.isArray(data.warnings)
				? data.warnings.filter((w): w is string => typeof w === 'string')
				: [];
			testStatus = 'ok';
		} catch {
			testStatus = 'fail';
			testCode = 'generic';
		} finally {
			busy = false;
		}
	}

	function canAdvance(): boolean {
		if (step === 'voice') return rotation || voiceUrlKey.trim().length > 0;
		if (step === 'xai') return rotation || xaiApiKey.trim().length > 0;
		if (step === 'hermes') return rotation || hermesApiKey.trim().length > 0;
		return true;
	}

	function next() {
		if (stepIndex < steps.length - 1) {
			stepIndex += 1;
			testStatus = 'idle';
			testCode = '';
			warnings = [];
			saveError = '';
		}
	}

	function back() {
		if (stepIndex > 0) {
			stepIndex -= 1;
			testStatus = 'idle';
			testCode = '';
			warnings = [];
			saveError = '';
		}
	}

	async function save() {
		busy = true;
		saveError = '';
		try {
			const { data } = await postJson('/api/setup/save', {
				voiceUrlKey: voiceUrlKey || undefined,
				xaiApiKey: xaiApiKey || undefined,
				hermesApiBase: hermesApiBase || undefined,
				hermesApiKey: hermesApiKey || undefined,
				hermesSessionKey: hermesSessionKey || undefined,
				origin: origin || undefined
			});
			if (data.ok === true) {
				saved = true;
			} else {
				saveError = typeof data.code === 'string' ? data.code : 'generic';
			}
		} catch {
			saveError = 'generic';
		} finally {
			busy = false;
		}
	}

	const stepTitle = $derived(
		step === 'voice'
			? t('wizard.stepVoice', locale)
			: step === 'xai'
				? t('wizard.stepXai', locale)
				: step === 'hermes'
					? t('wizard.stepHermes', locale)
					: step === 'origin'
						? t('wizard.stepOrigin', locale)
						: t('wizard.stepSave', locale)
	);
</script>

<div class="gate">
	<div class="glow" aria-hidden="true"></div>
	<div class="locale-corner">
		<LocaleSwitch />
	</div>

	<div class="panel">
		<p class="brand">{t('wizard.brand', locale)}</p>
		<h1>{t('wizard.title', locale)}</h1>

		{#if rotation}
			<p class="banner">{t('wizard.rotationBanner', locale)}</p>
		{/if}

		{#if saved}
			<div class="done">
				<h2>{t('wizard.savedTitle', locale)}</h2>
				<p>{t('wizard.savedBody', locale)}</p>
				<p class="hint mono">{t('wizard.restartHint', locale)}</p>
				<a class="btn primary" href={voiceUrlKey ? `/?k=${encodeURIComponent(voiceUrlKey)}` : '/'}
					>{t('wizard.openLounge', locale)}</a
				>
			</div>
		{:else}
			<p class="step-label">{stepTitle} · {stepIndex + 1}/{steps.length}</p>

			{#if step === 'voice'}
				<label class="field">
					<span>{t('wizard.voiceKeyLabel', locale)}</span>
					<input type="password" autocomplete="off" bind:value={voiceUrlKey} />
				</label>
				<p class="hint">{t('wizard.voiceKeyHint', locale)}</p>
				<button type="button" class="btn ghost" onclick={generateKey}
					>{t('wizard.generateKey', locale)}</button
				>
			{:else if step === 'xai'}
				<label class="field">
					<span>{t('wizard.xaiKeyLabel', locale)}</span>
					<input type="password" autocomplete="off" bind:value={xaiApiKey} />
				</label>
				<p class="hint">{t('wizard.xaiKeyHint', locale)}</p>
				<button type="button" class="btn ghost" disabled={busy} onclick={testXai}>
					{busy ? t('wizard.testing', locale) : t('wizard.test', locale)}
				</button>
			{:else if step === 'hermes'}
				<label class="field">
					<span>{t('wizard.hermesBaseLabel', locale)}</span>
					<input type="url" autocomplete="off" bind:value={hermesApiBase} />
				</label>
				<label class="field">
					<span>{t('wizard.hermesKeyLabel', locale)}</span>
					<input type="password" autocomplete="off" bind:value={hermesApiKey} />
				</label>
				<label class="field">
					<span>{t('wizard.hermesSessionLabel', locale)}</span>
					<input type="text" autocomplete="off" bind:value={hermesSessionKey} />
				</label>
				<p class="hint">{t('wizard.hermesHint', locale)}</p>
				<button type="button" class="btn ghost" disabled={busy} onclick={testHermes}>
					{busy ? t('wizard.testing', locale) : t('wizard.test', locale)}
				</button>
			{:else if step === 'origin'}
				<label class="field">
					<span>{t('wizard.originLabel', locale)}</span>
					<input type="url" autocomplete="off" bind:value={origin} />
				</label>
				<p class="hint">{t('wizard.originHint', locale)}</p>
				<button type="button" class="btn ghost" disabled={busy} onclick={testOrigin}>
					{busy ? t('wizard.testing', locale) : t('wizard.test', locale)}
				</button>
				{#if warnings.length > 0}
					<p class="warn-title">{t('wizard.warnings', locale)}</p>
					<ul class="warn-list">
						{#each warnings as w (w)}
							<li>{w}</li>
						{/each}
					</ul>
				{/if}
			{:else}
				<p class="hint">{t('wizard.savedBody', locale)}</p>
				{#if saveError}
					<p class="fail" role="alert">{errorMessage(saveError)}</p>
				{/if}
				<button type="button" class="btn primary" disabled={busy} onclick={save}>
					{busy ? t('wizard.saving', locale) : t('wizard.save', locale)}
				</button>
			{/if}

			{#if testStatus === 'ok' && step !== 'save'}
				<p class="ok" role="status">{t('wizard.testOk', locale)}</p>
			{:else if testStatus === 'fail'}
				<p class="fail" role="alert">{t('wizard.testFailed', locale)}: {errorMessage(testCode)}</p>
			{/if}

			{#if step !== 'save'}
				<div class="nav">
					<button type="button" class="btn ghost" disabled={stepIndex === 0} onclick={back}
						>{t('wizard.back', locale)}</button
					>
					<button type="button" class="btn primary" disabled={!canAdvance()} onclick={next}
						>{t('wizard.next', locale)}</button
					>
				</div>
			{:else}
				<div class="nav">
					<button type="button" class="btn ghost" onclick={back}>{t('wizard.back', locale)}</button>
				</div>
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
		width: min(28rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		text-align: left;
	}

	.brand {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.2rem, 3.5vw, 1.6rem);
		font-weight: 500;
		letter-spacing: 0.22em;
		line-height: 1;
		text-indent: 0.22em;
		color: rgba(232, 247, 248, 0.45);
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.2rem, 3.2vw, 1.55rem);
		font-weight: 500;
		text-align: center;
	}

	h2 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 500;
	}

	.banner,
	.hint,
	.step-label {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.45;
	}

	.banner {
		border-left: 2px solid rgba(94, 231, 255, 0.45);
		padding-left: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.82rem;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.field input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.65rem 0.75rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 0.55rem;
		background: rgba(4, 20, 24, 0.65);
		color: var(--ink);
		font: inherit;
		font-size: 0.95rem;
		letter-spacing: normal;
	}

	.field input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.4rem;
		padding: 0.45rem 1rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.92rem;
		cursor: pointer;
		text-decoration: none;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn.primary {
		background: rgba(94, 231, 255, 0.16);
		border-color: rgba(94, 231, 255, 0.45);
	}

	.btn.ghost {
		align-self: flex-start;
	}

	.nav {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.35rem;
	}

	.ok {
		margin: 0;
		color: #7dffb2;
		font-size: 0.9rem;
	}

	.fail {
		margin: 0;
		color: #ff8f8f;
		font-size: 0.9rem;
	}

	.warn-title {
		margin: 0.25rem 0 0;
		color: #ffd48a;
		font-size: 0.85rem;
	}

	.warn-list {
		margin: 0;
		padding-left: 1.1rem;
		color: #ffd48a;
		font-size: 0.85rem;
	}

	.done {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-align: center;
	}

	.done .btn {
		align-self: center;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.82rem;
	}
</style>
