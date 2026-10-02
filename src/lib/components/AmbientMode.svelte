<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { getLocale, t } from '$lib/i18n';
	import type { VoiceDemoState } from '$lib/voice/voiceDemo';

	type Glance = { nextEvent: { title: string; when?: string } | null; unread: number | null };

	let {
		assistantName,
		voiceState,
		statusLabel,
		readyCount,
		onToggleTalk,
		onSpeakReady,
		onExit
	}: {
		assistantName: string;
		voiceState: VoiceDemoState;
		statusLabel: string;
		readyCount: number;
		onToggleTalk: () => void;
		onSpeakReady: () => void;
		onExit: () => void;
	} = $props();

	const GLANCE_REFRESH_MS = 10 * 60_000;

	let now = $state(new Date());
	let glance = $state<Glance | null>(null);
	let glanceState = $state<'loading' | 'ok' | 'unavailable'>('loading');
	let rootEl: HTMLDivElement | undefined = $state();

	const timeText = $derived(
		now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
	);
	const dateText = $derived(
		now.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
	);

	async function loadGlance() {
		try {
			const res = await fetch('/api/glance', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) {
				glanceState = glance ? 'ok' : 'unavailable';
				return;
			}
			const data = (await res.json()) as { ok?: boolean } & Partial<Glance>;
			if (!data.ok) {
				glanceState = glance ? 'ok' : 'unavailable';
				return;
			}
			glance = { nextEvent: data.nextEvent ?? null, unread: data.unread ?? null };
			glanceState = 'ok';
		} catch {
			glanceState = glance ? 'ok' : 'unavailable';
		}
	}

	const clock = setInterval(() => (now = new Date()), 15_000);
	const refresher = setInterval(() => void loadGlance(), GLANCE_REFRESH_MS);

	onMount(() => {
		void loadGlance();
		void tick().then(() => rootEl?.focus());
		// Best effort — not every browser/PWA context allows it, and that's fine.
		document.documentElement.requestFullscreen?.().catch(() => {});
	});

	onDestroy(() => {
		clearInterval(clock);
		clearInterval(refresher);
		if (typeof document !== 'undefined' && document.fullscreenElement) {
			document.exitFullscreen?.().catch(() => {});
		}
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onExit();
		}
	}
</script>

<div
	class="ambient"
	data-state={voiceState}
	role="dialog"
	aria-modal="true"
	aria-label={t('ambient.title')}
	tabindex="-1"
	bind:this={rootEl}
	onkeydown={onKeydown}
	transition:fade={{ duration: 300 }}
>
	<div class="ambient__info">
		<p class="ambient__time">{timeText}</p>
		<p class="ambient__date">{dateText}</p>
		<div class="ambient__tiles">
			<div class="tile">
				<span class="tile__label">{t('ambient.next')}</span>
				<span class="tile__value">
					{#if glanceState === 'loading'}
						…
					{:else if glanceState === 'unavailable'}
						{t('ambient.unavailable')}
					{:else if glance?.nextEvent}
						{glance.nextEvent.title}{glance.nextEvent.when ? ` · ${glance.nextEvent.when}` : ''}
					{:else}
						{t('ambient.nothingNext')}
					{/if}
				</span>
			</div>
			<div class="tile">
				<span class="tile__label">{t('ambient.inbox')}</span>
				<span class="tile__value">
					{#if glanceState === 'ok' && glance?.unread !== null && glance?.unread !== undefined}
						{glance.unread} {t('ambient.unread')}
					{:else if glanceState === 'loading'}
						…
					{:else}
						—
					{/if}
				</span>
			</div>
			{#if readyCount > 0}
				<button type="button" class="tile tile--ready" onclick={onSpeakReady}>
					<span class="tile__label">{t('ambient.tasks')} · {readyCount}</span>
					<span class="tile__value">{t('status.resultsReady')}</span>
				</button>
			{/if}
		</div>
	</div>

	<div class="ambient__orb-wrap">
		<button
			type="button"
			class="ambient__orb"
			aria-label={statusLabel}
			aria-pressed={voiceState === 'listening' || voiceState === 'speaking'}
			onclick={onToggleTalk}
		>
			<span class="ambient__brand">{assistantName.toUpperCase()}</span>
		</button>
		<p class="ambient__status" aria-live="polite">{statusLabel}</p>
	</div>

	<button type="button" class="ambient__exit" aria-label={t('ambient.exit')} onclick={onExit}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
			><path
				d="M6 6l12 12M18 6L6 18"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/></svg
		>
	</button>
</div>

<style>
	.ambient {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2.5rem;
		box-sizing: border-box;
		padding: max(1.5rem, env(safe-area-inset-top)) max(2rem, env(safe-area-inset-right))
			max(1.5rem, env(safe-area-inset-bottom)) max(2rem, env(safe-area-inset-left));
		background: radial-gradient(ellipse at 72% 50%, #0b3036 0%, #04100f 55%, #020606 100%);
		color: #e8f7f8;
		font-family: 'DM Sans', system-ui, sans-serif;
		outline: none;
	}

	.ambient__info {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.ambient__time {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(3.5rem, 13vw, 7.5rem);
		font-weight: 400;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.ambient__date {
		margin: 0 0 1.2rem;
		color: #a9d2d6;
		font-size: clamp(1rem, 2.4vw, 1.25rem);
		text-transform: capitalize;
	}

	.ambient__tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.tile {
		min-width: 9rem;
		max-width: 22rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.8rem 1rem;
		border: 1px solid rgba(142, 184, 188, 0.25);
		border-radius: 1.1rem;
		background: rgba(10, 27, 30, 0.8);
		color: inherit;
		font: inherit;
		text-align: left;
	}

	.tile--ready {
		border-color: rgba(202, 253, 255, 0.4);
		background: rgba(202, 253, 255, 0.08);
		cursor: pointer;
	}

	.tile__label {
		color: #8eb8bc;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.tile__value {
		font-size: 1.02rem;
		overflow-wrap: anywhere;
	}

	.ambient__orb-wrap {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
	}

	.ambient__orb {
		width: clamp(10rem, 30vmin, 16rem);
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 4px solid #7fb3b8;
		border-radius: 50%;
		background: radial-gradient(circle at 50% 45%, #3f777d 0%, #12393e 55%, #0b2a2e 100%);
		box-shadow: 0 0 60px rgba(94, 231, 255, 0.18);
		color: #f3fdfd;
		cursor: pointer;
		animation: ambient-breathe 6s ease-in-out infinite;
	}

	.ambient[data-state='listening'] .ambient__orb {
		border-color: #5ee7ff;
		box-shadow: 0 0 80px rgba(94, 231, 255, 0.4);
		animation-duration: 2.2s;
	}

	.ambient[data-state='speaking'] .ambient__orb {
		border-color: #cafdff;
		box-shadow: 0 0 90px rgba(202, 253, 255, 0.4);
		animation-duration: 1.2s;
	}

	.ambient__orb:focus-visible,
	.ambient__exit:focus-visible,
	.tile--ready:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 4px;
	}

	@keyframes ambient-breathe {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.03);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ambient__orb {
			animation: none;
		}
	}

	.ambient__brand {
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1rem, 3vmin, 1.4rem);
		letter-spacing: 0.3em;
		text-indent: 0.3em;
	}

	.ambient__status {
		margin: 0;
		color: #a9d2d6;
		font-size: 0.92rem;
		text-align: center;
		max-width: 16rem;
	}

	.ambient__exit {
		position: absolute;
		top: max(1rem, env(safe-area-inset-top));
		right: max(1rem, env(safe-area-inset-right));
		width: 2.75rem;
		height: 2.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(142, 184, 188, 0.3);
		border-radius: 999px;
		background: transparent;
		color: #a9d2d6;
		cursor: pointer;
	}

	@media (orientation: portrait) {
		.ambient {
			flex-direction: column-reverse;
			justify-content: center;
			text-align: center;
		}
		.ambient__info {
			align-items: center;
		}
		.ambient__tiles {
			justify-content: center;
		}
	}
</style>
