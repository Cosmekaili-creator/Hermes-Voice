<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getLocale, t, type Locale } from '$lib/i18n';
	import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';

	let { data } = $props();

	const locale = $derived((browser ? getLocale() : page.data.locale) as Locale);

	type Check = { ok: boolean; code?: string };

	let loading = $state(false);
	let voice = $state<Check | null>(null);
	let xai = $state<Check | null>(null);
	let hermes = $state<Check | null>(null);
	let micHint = $state<'unknown' | 'ok' | 'denied'>('unknown');

	async function refresh() {
		if (!data.authenticated) return;
		loading = true;
		try {
			const res = await fetch('/api/owner/health', { credentials: 'same-origin' });
			const json = (await res.json().catch(() => null)) as null | {
				voice?: Check;
				xai?: Check;
				hermes?: Check;
			};
			if (json) {
				voice = json.voice ?? null;
				xai = json.xai ?? null;
				hermes = json.hermes ?? null;
			}
		} finally {
			loading = false;
		}
	}

	async function checkMic() {
		if (!browser || !navigator.mediaDevices?.getUserMedia) {
			micHint = 'unknown';
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of stream.getTracks()) track.stop();
			micHint = 'ok';
		} catch {
			micHint = 'denied';
		}
	}

	onMount(() => {
		if (data.authenticated) void refresh();
	});

	function statusLabel(check: Check | null): string {
		if (loading && !check) return t('health.checking', locale);
		if (!check) return '—';
		return check.ok ? t('health.ok', locale) : `${t('health.fail', locale)}${check.code ? ` (${check.code})` : ''}`;
	}
</script>

<div class="gate">
	<div class="glow" aria-hidden="true"></div>
	<div class="locale-corner"><LocaleSwitch /></div>

	<div class="panel">
		<p class="brand">{t('wizard.brand', locale)}</p>
		<h1>{t('health.title', locale)}</h1>

		{#if !data.authenticated}
			<p class="body">{t('health.needAuth', locale)}</p>
			<a class="link" href="/">{t('wizard.openLounge', locale)}</a>
		{:else}
			<ul class="checks">
				<li>
					<span>{t('health.voice', locale)}</span>
					<strong class:ok={voice?.ok} class:fail={voice && !voice.ok}>{statusLabel(voice)}</strong>
				</li>
				<li>
					<span>{t('health.xai', locale)}</span>
					<strong class:ok={xai?.ok} class:fail={xai && !xai.ok}>{statusLabel(xai)}</strong>
				</li>
				<li>
					<span>{t('health.hermes', locale)}</span>
					<strong class:ok={hermes?.ok} class:fail={hermes && !hermes.ok}>{statusLabel(hermes)}</strong>
				</li>
				<li>
					<span>{t('health.mic', locale)}</span>
					<strong class:ok={micHint === 'ok'} class:fail={micHint === 'denied'}>
						{micHint === 'ok'
							? t('health.micOk', locale)
							: micHint === 'denied'
								? t('health.micDenied', locale)
								: t('health.micUnknown', locale)}
					</strong>
				</li>
			</ul>

			<div class="actions">
				<button type="button" class="btn" disabled={loading} onclick={refresh}
					>{t('health.refresh', locale)}</button
				>
				<button type="button" class="btn ghost" onclick={checkMic}
					>{t('health.micCheck', locale)}</button
				>
				<a class="link" href="/setup">{t('health.backSetup', locale)}</a>
			</div>
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

	h1 {
		margin: 0;
		font-size: clamp(1.2rem, 3.2vw, 1.55rem);
		font-weight: 500;
		text-align: center;
	}

	.body {
		margin: 0;
		color: var(--muted);
		text-align: center;
		line-height: 1.45;
	}

	.checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.checks li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: baseline;
		padding: 0.35rem 0;
		border-bottom: 1px solid rgba(202, 253, 255, 0.12);
		font-size: 0.95rem;
	}

	.checks span {
		color: var(--muted);
	}

	.checks strong {
		font-weight: 500;
		text-align: right;
	}

	.ok {
		color: #7dffb2;
	}

	.fail {
		color: #ff8f8f;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: center;
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

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.link {
		color: var(--accent);
		text-decoration: none;
		font-size: 0.92rem;
	}
</style>
