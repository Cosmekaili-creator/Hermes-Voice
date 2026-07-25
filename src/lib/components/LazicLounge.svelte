<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, t } from '$lib/i18n';
	import { createVoiceDemo } from '$lib/voice/voiceDemo';
	import { drawLazicLounge, type VizQuality } from '$lib/viz/lazicLounge';
	import { createScreenWakeLock } from '$lib/wakeLock';
	import LocaleSwitch from './LocaleSwitch.svelte';
	import TalkModeSwitch from './TalkModeSwitch.svelte';

	// Auth is cookie-only: SSR grants HttpOnly session from valid ?k=; SPA never retains the key.
	const demo = createVoiceDemo();
	const wakeLock = createScreenWakeLock();
	/** Must match AnalyserNode.frequencyBinCount for fftSize 512 (not fftSize itself). */
	const freqBuf = new Uint8Array(256);
	const idleBars = new Uint8Array(256); // near-flat idle/thinking — no fake speech motion


	let canvasEl: HTMLCanvasElement | undefined = $state();

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
			return demo.cancelArmed ? t('button.cancelArm') : t('button.cancel');
		}
		const handsfree = demo.talkMode === 'handsfree';
		switch (demo.state) {
			case 'idle':
				if (demo.busy) return t('button.connecting');
				if (demo.needsReconnect) return t('button.reconnect');
				return handsfree ? t('button.armHandsfree') : t('button.pressToTalk');
			case 'listening':
				return handsfree ? t('button.disarmHandsfree') : t('button.finishSpeaking');
			case 'thinking':
				return t('button.hermesThinking');
			case 'speaking':
				return t('button.stopHermes');
		}
	});

	$effect(() => {
		getLocale();
		demo.refreshInstructions();
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
		return () => {
			void wakeLock.disable();
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
			let spectrum: Uint8Array = idleBars;
			let energy = ambientIntensity;

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

	<div class="locale-corner">
		<TalkModeSwitch mode={demo.talkMode} onChange={(m) => demo.setTalkMode(m)} />
		<LocaleSwitch />
	</div>

	<div class="center">
		<p class="brand">HERMES</p>
		<p class="status" aria-live="polite">{demo.statusLabel}</p>
		{#if demo.waitElapsedSec !== null}
			<p class="status-timer" aria-live="off">{demo.waitElapsedSec}s</p>
		{/if}
	</div>

	<div class="dock">
		<button
			type="button"
			class="talk"
			class:talk--cancel={demo.isHermesWorking}
			aria-pressed={pressed}
			aria-label={buttonLabel}
			disabled={demo.buttonDisabled}
			onclick={() => demo.toggle()}
		>
			<span class="talk__dot" aria-hidden="true"></span>
			<span>{buttonLabel}</span>
		</button>
	</div>
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
		background:
			radial-gradient(ellipse at 50% 45%, #0d3a40 0%, #061618 42%, #030a0c 100%);
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

	.locale-corner {
		position: absolute;
		z-index: 4;
		top: max(0.85rem, env(safe-area-inset-top));
		right: max(0.85rem, env(safe-area-inset-right));
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
		max-width: calc(100vw - 1.7rem);
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

	.status-timer {
		margin: -0.25rem 0 0;
		min-height: 1.1em;
		color: var(--muted);
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
		opacity: 0.85;
	}

	.dock {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: max(2rem, 12dvh);
		display: flex;
		justify-content: center;
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
