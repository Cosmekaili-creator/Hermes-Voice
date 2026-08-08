<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { getLocale, t, type MessageKey } from '$lib/i18n';
	import { DEFAULT_PERSONA, type VoicePersona } from '$lib/persona/types';
	import type { ProviderId } from '$lib/providers/types';
	import { createVoiceDemo } from '$lib/voice/voiceDemo';
	import { markMicPrimed, shouldPrimeMic } from '$lib/voice/micPrimer';
	import { drawLazicLounge, type VizQuality } from '$lib/viz/lazicLounge';
	import { createScreenWakeLock } from '$lib/wakeLock';
	import SettingsModal from './settings/SettingsModal.svelte';
	import LocaleSwitch from './LocaleSwitch.svelte';
	import MicPrimer from './MicPrimer.svelte';
	import TalkModeSwitch from './TalkModeSwitch.svelte';
	import TextComposer from './TextComposer.svelte';

	const PROVIDER_LABELS: Record<ProviderId, string> = {
		xai: 'xAI',
		openai: 'OpenAI'
	};

	let {
		persona = DEFAULT_PERSONA,
		provider,
		isOwner = false
	}: { persona?: VoicePersona; provider?: ProviderId; isOwner?: boolean } = $props();

	let settingsOpen = $state(false);
	let settingsSection = $state<'provider' | 'hermes'>('provider');

	function openSettings(section: 'provider' | 'hermes') {
		settingsSection = section;
		settingsOpen = true;
	}

	/**
	 * Explicit third arg on every t() call in this component (and inline child components
	 * that call t() with an {assistant}-bearing key) — guarantees correct SSR output with
	 * no default→custom-name flash. setAssistantName()/getAssistantName() (called from
	 * +layout.svelte) remain the ambient fallback for anything that calls t() without an
	 * explicit override.
	 */
	function pt(key: MessageKey): string {
		return t(key, getLocale(), persona.assistantName);
	}

	// Auth is cookie-only: SSR grants HttpOnly session from valid ?k=; SPA never retains the key.
	// persona is tied to the authenticated binding for the life of this component (a change
	// implies a different session entirely) — read once intentionally, not reactively.
	const demo = createVoiceDemo({ persona: untrack(() => persona) });
	const wakeLock = createScreenWakeLock();
	/** Must match AnalyserNode.frequencyBinCount for fftSize 512 (not fftSize itself). */
	const freqBuf = new Uint8Array(256);
	const idleBars = new Uint8Array(256); // near-flat idle/thinking — no fake speech motion

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let showMicPrimer = $state(false);
	let primerTimer: ReturnType<typeof setTimeout> | null = null;

	function dismissPrimer() {
		showMicPrimer = false;
		if (primerTimer !== null) {
			clearTimeout(primerTimer);
			primerTimer = null;
		}
	}

	const pressed = $derived(demo.state === 'listening' || demo.state === 'speaking');
	const ambientIntensity = $derived.by(() => {
		if (demo.isHermesWorking) return 0.72;
		switch (demo.state) {
			case 'idle':
				return 0.35;
			case 'thinking':
				return 0.5;
			default:
				return 0.35;
		}
	});

	const buttonLabel = $derived.by(() => {
		if (demo.isHermesWorking) {
			return pt('button.cancel');
		}
		const handsfree = demo.talkMode === 'handsfree';
		switch (demo.state) {
			case 'idle':
				if (demo.busy) return pt('button.connecting');
				if (demo.needsReconnect) return pt('button.reconnect');
				return handsfree ? pt('button.armHandsfree') : pt('button.pressToTalk');
			case 'listening':
				return handsfree ? pt('button.disarmHandsfree') : pt('button.finishSpeaking');
			case 'thinking':
				return pt('button.hermesThinking');
			case 'speaking':
				return pt('button.stopHermes');
		}
	});

	$effect(() => {
		getLocale();
		demo.refreshInstructions();
	});

	let captionsEl: HTMLDivElement | undefined = $state();

	// Keep the newest line in view as text reveals; skip while the reader scrolled up.
	let captionPinned = $state(true);

	function onCaptionScroll() {
		const el = captionsEl;
		if (!el) return;
		captionPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
	}

	$effect(() => {
		const el = captionsEl;
		const lines = demo.captionLines;
		// Depend on both line count and the growing tail so reveal ticks re-scroll.
		const tail = lines.length > 0 ? lines[lines.length - 1]!.text : '';
		if (!el || !captionPinned) return;
		void tail;
		el.scrollTop = el.scrollHeight;
	});

	$effect(() => {
		if (demo.captionPhase === 'hidden') captionPinned = true;
	});

	function loungeRadius() {
		return Math.min(180, window.innerWidth * 0.28);
	}

	/** Cap backing-store size — full DPR on a fullscreen canvas tanks mobile GPUs. */
	function pixelRatio(quality: VizQuality) {
		const raw = window.devicePixelRatio || 1;
		if (quality === 'low') return Math.min(raw, 1.25);
		if (quality === 'medium') return Math.min(raw, 1.5);
		return Math.min(raw, 2);
	}

	function detectQuality(): VizQuality {
		const coarse = window.matchMedia('(pointer: coarse)').matches;
		const narrow = window.matchMedia('(max-width: 720px)').matches;
		const saveData =
			'mconnection' in navigator &&
			(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
		const lowMem =
			'deviceMemory' in navigator &&
			(navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined &&
			(navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 4;
		if (saveData || lowMem) return 'low';
		if (coarse || narrow) return 'low';
		return 'high';
	}

	function resizeCanvas(canvas: HTMLCanvasElement, quality: VizQuality) {
		const dpr = pixelRatio(quality);
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		const tw = Math.max(1, Math.floor(w * dpr));
		const th = Math.max(1, Math.floor(h * dpr));
		if (canvas.width !== tw || canvas.height !== th) {
			canvas.width = tw;
			canvas.height = th;
		}
		const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
		if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	// onMount — not $effect. warm() reads busy/state; an $effect would re-run on tap,
	// destroy the session in cleanup, and leave the UI stuck on "Connecting…".
	onMount(() => {
		void wakeLock.enable();
		void demo.warm();
		void shouldPrimeMic().then((prime) => {
			if (!prime) return;
			markMicPrimed(); // one-time per browser, marked on display
			showMicPrimer = true;
			primerTimer = setTimeout(dismissPrimer, 12_000);
		});
		return () => {
			void wakeLock.disable();
			dismissPrimer();
			demo.destroy();
		};
	});

	$effect(() => {
		const canvas = canvasEl;
		if (!canvas) return;

		let quality = detectQuality();
		const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
		if (!ctx) return;

		resizeCanvas(canvas, quality);

		const onResize = () => {
			quality = detectQuality();
			resizeCanvas(canvas, quality);
		};
		window.addEventListener('resize', onResize);

		let raf = 0;
		const frame = (now: number) => {
			const state = demo.state;
			let spectrum: Uint8Array;
			let energy: number;

			if (state === 'listening') {
				const mic = demo.micAnalyser;
				if (mic) {
					mic.getByteFrequencyData(freqBuf);
				} else {
					freqBuf.fill(0);
				}
				spectrum = freqBuf;
				energy = 0.85;
			} else if (state === 'speaking') {
				const play = demo.playAnalyser;
				if (play) {
					play.getByteFrequencyData(freqBuf);
				} else {
					freqBuf.fill(0);
				}
				spectrum = freqBuf;
				energy = 1;
			} else {
				// idle / thinking — flat bars; particles/glow still use ambient energy
				// (synth kept for possible future use; do not drive live bars — looks like speech)
				spectrum = idleBars;
				energy = ambientIntensity;
			}

			drawLazicLounge(ctx, canvas, spectrum, {
				barWidth: 2,
				barHeight: 2,
				barSpacing: 7,
				barColor: '#cafdff',
				shadowBlur: 24,
				shadowColor: '#5ee7ff',
				radius: loungeRadius(),
				energy,
				nowMs: now,
				quality
			});
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

<div class="lounge-stage" data-state={demo.state} data-hermes={demo.isHermesWorking ? '1' : '0'}>
	<div class="glow-field" aria-hidden="true"></div>
	<canvas class="viz" bind:this={canvasEl} aria-hidden="true"></canvas>

	<div class="mode-corner">
		<TalkModeSwitch mode={demo.talkMode} onChange={(m) => demo.setTalkMode(m)} />
	</div>
	<div class="locale-corner">
		<!-- Rendered unconditionally, not gated on demo.provider — today the pill only
		     appeared after a successful mint, i.e. it disappeared exactly when a broken
		     key made settings most necessary. `provider` (SSR value from +page.server.ts)
		     seeds the label; `demo.provider` overrides once a session actually mints. -->
		{#if isOwner}
			<button type="button" class="provider-badge" onclick={() => openSettings('provider')}>
				<span class="provider-badge__label">{pt('meta.provider')}: </span>{PROVIDER_LABELS[
					demo.provider ?? provider ?? 'xai'
				]}
			</button>
			<button
				type="button"
				class="settings-gear"
				aria-label={pt('settings.open')}
				onclick={() => openSettings('hermes')}
			>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
					<path
						fill="currentColor"
						d="M19.14 12.94a7.14 7.14 0 0 0 .06-.94 7.14 7.14 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64Zm-7.14 2.44a3.38 3.38 0 1 1 0-6.76 3.38 3.38 0 0 1 0 6.76Z"
					/>
				</svg>
			</button>
		{:else if demo.provider ?? provider}
			<p class="provider-badge provider-badge--inert">
				<span class="provider-badge__label">{pt('meta.provider')}: </span>{PROVIDER_LABELS[
					demo.provider ?? provider ?? 'xai'
				]}
			</p>
		{/if}
		<LocaleSwitch />
	</div>

	{#if demo.captionLines.length > 0 || demo.captionUserEcho || demo.captionPhase !== 'hidden'}
		<div
			class="captions"
			class:captions--fade={demo.captionPhase === 'fading'}
			aria-live="off"
			aria-label={pt('status.captions')}
			bind:this={captionsEl}
			onscroll={onCaptionScroll}
		>
			{#if demo.captionUserEcho}
				<p class="captions__line captions__line--user">{demo.captionUserEcho}</p>
			{/if}
			{#each demo.captionLines as line (line.id)}
				<p
					class="captions__line"
					class:captions__line--soft={line.soft}
					in:fly={{ y: 6, duration: 220 }}
					out:fly={{ y: -10, duration: 280 }}
				>
					{line.text}
				</p>
			{/each}
		</div>
	{/if}

	<div class="center">
		<p class="brand">{persona.assistantName.toUpperCase()}</p>
		<p class="status" aria-live="polite">{demo.statusLabel}</p>
		{#if demo.voiceFallbackNotice}
			<!-- B12 connect-time voice fallback: a rejected per-binding voice degraded
			     gracefully to the provider default instead of killing the session — this
			     is the non-fatal notice surfacing that. -->
			<p class="status-notice" aria-live="polite">{pt(demo.voiceFallbackNotice as MessageKey)}</p>
		{/if}
		{#if demo.statusKey === 'error.micDenied'}
			<button type="button" class="retry" onclick={() => demo.retryMic()}
				>{pt('button.retryMic')}</button
			>
		{/if}
		{#if demo.talkMode === 'handsfree' && demo.state === 'speaking'}
			<p class="mic-chip" class:mic-chip--live={demo.micLive} aria-live="off">
				<span class="mic-chip__dot" aria-hidden="true"></span>
				{demo.micLive ? pt('status.micLive') : pt('status.micMuted')}
			</p>
		{/if}
		{#if demo.hermesWaitActivity}
			<p class="status-activity" aria-live="off">{demo.hermesWaitActivity}</p>
		{/if}
		{#if demo.waitElapsedSec !== null}
			<p class="status-timer" aria-live="off">{demo.waitElapsedSec}s</p>
		{/if}
	</div>

	<div class="dock">
		{#if showMicPrimer}
			<MicPrimer onDismiss={dismissPrimer} assistantName={persona.assistantName} />
		{/if}

		<button
			type="button"
			class="talk"
			class:talk--cancel={demo.isHermesWorking}
			aria-pressed={pressed}
			aria-label={buttonLabel}
			disabled={demo.buttonDisabled}
			onclick={() => {
				dismissPrimer();
				demo.toggle();
			}}
		>
			<span class="talk__dot" aria-hidden="true"></span>
			<span>{buttonLabel}</span>
		</button>

		<TextComposer
			enabled={demo.canSendText}
			onSend={(text) => demo.sendText(text)}
			assistantName={persona.assistantName}
		/>
	</div>

	{#if isOwner}
		<SettingsModal
			open={settingsOpen}
			section={settingsSection}
			{isOwner}
			onClose={() => (settingsOpen = false)}
			onReconnect={() => demo.forceReconnect()}
		/>
	{/if}
</div>

<style>
	.lounge-stage {
		--ink: #e8f7f8;
		--muted: #8eb8bc;
		--cyan: #cafdff;
		--accent: #5ee7ff;

		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		overflow: hidden;
		color: var(--ink);
		font-family: 'DM Sans', system-ui, sans-serif;
		background: radial-gradient(ellipse at 50% 45%, #0d3a40 0%, #061618 42%, #030a0c 100%);
	}

	.glow-field {
		position: absolute;
		inset: -10%;
		z-index: 0;
		pointer-events: none;
		background:
			radial-gradient(circle at 50% 46%, rgba(94, 231, 255, 0.16), transparent 42%),
			radial-gradient(circle at 30% 70%, rgba(202, 253, 255, 0.06), transparent 35%),
			radial-gradient(circle at 70% 30%, rgba(94, 231, 255, 0.07), transparent 32%);
		animation: field-breathe 7s ease-in-out infinite;
		/* Soft blur is expensive under continuous transform — desktop only */
		filter: blur(2px);
		contain: paint;
	}

	.lounge-stage[data-state='listening'] .glow-field {
		animation-duration: 3.2s;
	}

	.lounge-stage[data-state='speaking'] .glow-field {
		animation-duration: 1.8s;
	}

	.lounge-stage[data-state='thinking'] .glow-field {
		animation-duration: 4.5s;
	}

	.lounge-stage[data-hermes='1'] .glow-field {
		animation-duration: 2.2s;
		opacity: 1;
	}

	@keyframes field-breathe {
		0%,
		100% {
			opacity: 0.85;
		}
		50% {
			opacity: 1;
		}
	}

	@media (pointer: coarse), (max-width: 720px) {
		.glow-field {
			filter: none;
			inset: 0;
			animation: field-breathe-mobile 7s ease-in-out infinite;
			will-change: auto;
		}
	}

	@keyframes field-breathe-mobile {
		0%,
		100% {
			opacity: 0.75;
		}
		50% {
			opacity: 0.95;
		}
	}

	.viz {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}

	.mode-corner,
	.locale-corner {
		position: absolute;
		z-index: 4;
		top: max(0.85rem, env(safe-area-inset-top));
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		max-width: min(16rem, calc(50vw - 1rem));
	}

	.mode-corner {
		left: max(0.85rem, env(safe-area-inset-left));
		justify-content: flex-start;
	}

	.locale-corner {
		right: max(0.85rem, env(safe-area-inset-right));
		justify-content: flex-end;
	}

	.provider-badge {
		display: inline-flex;
		align-items: center;
		margin: 0;
		min-height: 1.8rem;
		padding: 0.2rem 0.6rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
		color: var(--muted);
		font: inherit;
		font-size: 0.66rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		opacity: 0.75;
	}

	/* Interactive (owner-only) variant — a <button>, not the inert <p> the non-owner
	   fallback still renders (see .provider-badge--inert below). */
	button.provider-badge {
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			opacity 0.15s ease;
	}

	button.provider-badge:hover {
		opacity: 1;
		border-color: rgba(202, 253, 255, 0.4);
	}

	button.provider-badge:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.provider-badge--inert {
		cursor: default;
	}

	.settings-gear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		height: 1.8rem;
		padding: 0;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
		color: var(--muted);
		cursor: pointer;
		opacity: 0.75;
		transition:
			border-color 0.15s ease,
			opacity 0.15s ease;
	}

	.settings-gear:hover {
		opacity: 1;
		border-color: rgba(202, 253, 255, 0.4);
	}

	.settings-gear:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* Announced by every screen reader, works on touch, needs no ARIA.
	   `title` never renders on touch, and <p> (role=paragraph) is
	   name-prohibited in ARIA 1.2, so aria-label exposure is browser-dependent. */
	.provider-badge__label {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* Above the Lazic ring — stable left-growing lines (center alignment shifts glyphs). */
	.captions {
		position: absolute;
		z-index: 3;
		left: 50%;
		top: max(8.75rem, calc(env(safe-area-inset-top) + 7rem));
		translate: -50% 0;
		margin: 0;
		width: min(28rem, calc(100vw - 2.5rem));
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.1rem;
		/* Grow in place: retain the full reply, cap visible height, scroll for the rest.
		   Vertical budget, derived — do not eyeball this:
		     46dvh    .center's `top: 46%` (keep these two numbers in sync)
		   − 3.15rem  half of .center's WORST-CASE height: ~4.5rem of always-on children
		              PLUS ~1.8rem for Item 7's .mic-chip, which renders in exactly the
		              state where captions are longest (handsfree + speaking). .center is
		              translate(-50%,-50%), so only half its height grows upward into us.
		   − 1rem     breathing room
		   − our own top offset (safe-area aware, mirrors the `top` declaration above)
		   Floor = today's 3-line box so small viewports never regress. */
		min-height: 0;
		max-height: max(
			calc(1.35em * 3 + 0.2rem),
			min(
				calc(1.35em * 12 + 0.2rem),
				calc(46dvh - 4.15rem - max(8.75rem, env(safe-area-inset-top, 0px) + 7rem))
			)
		);
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		scrollbar-width: none;
		scroll-behavior: smooth;
		color: var(--muted);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 400;
		letter-spacing: 0.03em;
		line-height: 1.35;
		text-align: left;
		pointer-events: auto;
		opacity: 0.95;
		transition: opacity 1.25s ease;
	}

	.captions::-webkit-scrollbar {
		width: 0;
		height: 0;
	}

	.captions__line {
		margin: 0;
		width: 100%;
		text-align: left;
		/* JS owns wrapping — nowrap keeps glyphs from reflowing mid-line. */
		white-space: nowrap;
		opacity: 1;
		transition: opacity 0.35s ease;
	}

	.captions__line--soft {
		opacity: 0.5;
	}

	.captions__line--user {
		/* JS wrapping only applies to Hermes lines — let the echo wrap naturally. */
		white-space: normal;
		color: var(--ink);
		opacity: 0.62;
	}

	.captions--fade {
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.captions {
			scroll-behavior: auto;
		}
		.captions__line {
			transition: none;
		}
		.mic-chip--live .mic-chip__dot {
			animation: none;
		}
	}

	.center {
		position: absolute;
		z-index: 3;
		left: 50%;
		top: 46%;
		translate: -50% -50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.65rem;
		text-align: center;
		pointer-events: none;
	}

	.brand {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.85rem, 5.5vw, 3rem);
		font-weight: 500;
		letter-spacing: 0.22em;
		line-height: 1;
		text-indent: 0.22em;
		text-shadow:
			0 0 18px rgba(202, 253, 255, 0.35),
			0 0 48px rgba(94, 231, 255, 0.2);
	}

	.status {
		margin: 0;
		min-height: 1.4em;
		max-width: 18rem;
		color: var(--muted);
		font-size: 0.88rem;
		letter-spacing: 0.03em;
		line-height: 1.35;
	}

	.status-activity {
		margin: -0.35rem 0 0;
		max-width: 20rem;
		color: var(--ink);
		font-size: 0.82rem;
		letter-spacing: 0.02em;
		line-height: 1.3;
		opacity: 0.9;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.status-notice {
		margin: -0.2rem 0 0;
		max-width: 20rem;
		color: #ffd98a;
		font-size: 0.78rem;
		letter-spacing: 0.02em;
		line-height: 1.3;
		opacity: 0.9;
	}

	.status-timer {
		margin: -0.35rem 0 0;
		min-height: 1.1em;
		color: var(--muted);
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
		opacity: 0.85;
	}

	.retry {
		pointer-events: auto;
		min-height: 1.8rem;
		padding: 0.25rem 0.9rem;
		border: 1px solid rgba(202, 253, 255, 0.45);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.7);
		color: var(--ink);
		font: inherit;
		font-size: 0.76rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		backdrop-filter: blur(6px);
	}
	.retry:hover {
		border-color: var(--cyan);
	}
	.retry:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.mic-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: -0.15rem 0 0;
		padding: 0.18rem 0.6rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
		color: var(--muted);
		font-size: 0.68rem;
		letter-spacing: 0.04em;
	}
	.mic-chip__dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: #4a6c70;
	}
	.mic-chip--live {
		border-color: rgba(94, 231, 255, 0.45);
		color: var(--ink);
	}
	.mic-chip--live .mic-chip__dot {
		background: var(--accent);
		box-shadow: 0 0 8px var(--accent);
		animation: talk-dot 1.6s ease-in-out infinite;
	}

	.dock {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: max(1rem, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.75rem;
		padding: 0 1.5rem;
	}

	.talk {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.65rem;
		min-height: 3.25rem;
		padding: 0.85rem 1.75rem;
		border: 1px solid rgba(202, 253, 255, 0.45);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.7);
		color: var(--ink);
		font: inherit;
		font-size: 0.95rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		backdrop-filter: blur(8px);
		box-shadow:
			0 0 24px rgba(94, 231, 255, 0.18),
			inset 0 0 20px rgba(202, 253, 255, 0.04);
		transition:
			border-color 0.2s ease,
			background 0.2s ease,
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.talk:hover:not(:disabled) {
		border-color: var(--cyan);
		background: rgba(8, 36, 40, 0.88);
		transform: translateY(-1px);
	}

	.talk:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	.talk:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.talk--cancel {
		border-color: rgba(255, 120, 120, 0.65);
		color: #ffd4d4;
		box-shadow:
			0 0 24px rgba(255, 100, 100, 0.22),
			inset 0 0 20px rgba(255, 140, 140, 0.06);
		cursor: pointer;
		opacity: 1;
	}

	.talk--cancel:hover:not(:disabled) {
		border-color: #ff8a8a;
		background: rgba(40, 12, 14, 0.88);
		transform: translateY(-1px);
	}

	.talk--cancel .talk__dot {
		background: #ff8a8a;
		box-shadow: 0 0 12px rgba(255, 120, 120, 0.85);
		animation: talk-dot 0.7s ease-in-out infinite;
	}

	.talk__dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--cyan);
		box-shadow: 0 0 12px var(--cyan);
	}

	.lounge-stage[data-state='listening'] .talk__dot {
		animation: talk-dot 0.9s ease-in-out infinite;
	}

	.lounge-stage[data-state='speaking'] .talk__dot {
		animation: talk-dot 0.45s ease-in-out infinite;
	}

	@keyframes talk-dot {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.45);
			opacity: 0.55;
		}
	}
</style>
