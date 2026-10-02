<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { getLocale, t, type MessageKey } from '$lib/i18n';
	import { DEFAULT_PERSONA, type VoicePersona } from '$lib/persona/types';
	import type { ProviderId } from '$lib/providers/types';
	import { createVoiceDemo } from '$lib/voice/voiceDemo';
	import { markMicPrimed, shouldPrimeMic } from '$lib/voice/micPrimer';
	import { drawLazicLounge, type VizMood, type VizQuality } from '$lib/viz/lazicLounge';
	import { readApprovalsEnabled, writeApprovalsEnabled } from '$lib/voice/approvals';
	import { createTimeline, type TimelineEntry } from '$lib/voice/timeline.svelte';
	import { createScreenWakeLock } from '$lib/wakeLock';
	import SettingsModal from './settings/SettingsModal.svelte';
	import AmbientMode from './AmbientMode.svelte';
	import ApprovalCard from './ApprovalCard.svelte';
	import ControlCenter from './ControlCenter.svelte';
	import MicPrimer from './MicPrimer.svelte';
	import ResultCards from './ResultCards.svelte';
	import TaskOrbit from './TaskOrbit.svelte';
	import TextComposer from './TextComposer.svelte';
	import TimelineSheet from './TimelineSheet.svelte';

	const PROVIDER_LABELS: Record<ProviderId, string> = {
		xai: 'xAI',
		openai: 'OpenAI'
	};

	let {
		persona = DEFAULT_PERSONA,
		provider,
		isOwner = false,
		asyncTasksEnabled = true,
		timelineScope = null
	}: {
		persona?: VoicePersona;
		provider?: ProviderId;
		isOwner?: boolean;
		asyncTasksEnabled?: boolean;
		timelineScope?: string | null;
	} = $props();

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
	const SPEECH_TIMELINE_KEY = 'hermes-voice.speechInTimeline';
	function readSpeechInTimeline(): boolean {
		// Opt-in: turning it on enables the provider's input transcription.
		if (!browser) return false;
		try {
			return localStorage.getItem(SPEECH_TIMELINE_KEY) === '1';
		} catch {
			return false;
		}
	}

	let confirmActions = $state(browser ? readApprovalsEnabled() : true);
	let speechInTimeline = $state(readSpeechInTimeline());
	let timelineOpen = $state(false);
	let controlOpen = $state(false);
	let ambientOpen = $state(false);

	const timeline = createTimeline({ persist: browser, scope: untrack(() => timelineScope) });

	const demo = createVoiceDemo({
		persona: untrack(() => persona),
		asyncTasksEnabled: untrack(() => asyncTasksEnabled),
		timeline,
		speechInTimeline: () => speechInTimeline,
		approvalsEnabled: () => confirmActions
	});

	function setConfirmActions(on: boolean) {
		confirmActions = on;
		writeApprovalsEnabled(on);
	}

	function setSpeechInTimeline(on: boolean) {
		speechInTimeline = on;
		try {
			localStorage.setItem(SPEECH_TIMELINE_KEY, on ? '1' : '0');
		} catch {
			/* ignore */
		}
	}

	const vizMood = $derived.by((): VizMood => {
		if (demo.statusKey?.startsWith('error.')) return 'error';
		if (demo.isHermesWorking || demo.state === 'thinking') return 'thinking';
		return demo.state;
	});

	const orbHint = $derived.by(() => {
		if (demo.state === 'speaking' || demo.state === 'listening' || demo.isHermesWorking) {
			return pt('orb.hintStop');
		}
		return demo.talkMode === 'handsfree' ? pt('orb.hintHandsfree') : pt('orb.hintPtt');
	});

	// --- Latest result cards: shown briefly above the dock, then live on in the timeline.
	let cardsTick = $state(Date.now());
	let dismissedCardsId = $state<string | null>(null);
	const CARDS_VISIBLE_MS = 2 * 60_000;
	const latestCards = $derived.by(() => {
		const entries = timeline.entries;
		for (let i = entries.length - 1; i >= Math.max(0, entries.length - 10); i--) {
			const e = entries[i]!;
			if (e.kind !== 'cards') continue;
			if (e.id === dismissedCardsId || cardsTick - e.at > CARDS_VISIBLE_MS) return null;
			return e as Extract<TimelineEntry, { kind: 'cards' }>;
		}
		return null;
	});

	// --- Orb gestures: tap = toggle · hold (push-to-talk) = talk while held · swipe down = stop.
	const HOLD_MS = 320;
	const SWIPE_PX = 60;
	let pressStartY: number | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let holdActive = false;
	let suppressClick = false;

	function clearHold() {
		if (holdTimer !== null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function onOrbDown(e: PointerEvent) {
		if (e.button !== 0) return;
		pressStartY = e.clientY;
		holdActive = false;
		clearHold();
		if (demo.talkMode === 'ptt' && demo.state === 'idle' && !demo.isHermesWorking && !demo.busy) {
			holdTimer = setTimeout(() => {
				holdTimer = null;
				holdActive = true;
				dismissPrimer();
				demo.toggle();
			}, HOLD_MS);
		}
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
	}

	function onOrbUp(e: PointerEvent) {
		clearHold();
		if (pressStartY === null) return;
		const dy = e.clientY - pressStartY;
		pressStartY = null;
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 400);
		if (holdActive) {
			holdActive = false;
			if (demo.state === 'listening') demo.toggle();
			return;
		}
		if (dy > SWIPE_PX) {
			if (demo.state === 'speaking' || demo.state === 'listening' || demo.isHermesWorking) {
				demo.toggle();
			}
			return;
		}
		dismissPrimer();
		demo.toggle();
	}

	function onOrbCancel() {
		clearHold();
		pressStartY = null;
		if (holdActive && demo.state === 'listening') demo.toggle();
		holdActive = false;
	}

	/** Keyboard (Enter/Space) and assistive-tech activation — pointer taps are handled above. */
	function onOrbClick() {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		dismissPrimer();
		demo.toggle();
	}

	// --- Edge swipes: up from the bottom edge → timeline; down from the top edge → controls.
	const EDGE_PX = 28;
	let edgeStart: { y: number; edge: 'top' | 'bottom' } | null = null;

	function onStageDown(e: PointerEvent) {
		const h = window.innerHeight;
		if (e.clientY > h - EDGE_PX) edgeStart = { y: e.clientY, edge: 'bottom' };
		else if (e.clientY < EDGE_PX) edgeStart = { y: e.clientY, edge: 'top' };
		else edgeStart = null;
	}

	function onStageUp(e: PointerEvent) {
		if (!edgeStart) return;
		const dy = e.clientY - edgeStart.y;
		if (edgeStart.edge === 'bottom' && dy < -SWIPE_PX) timelineOpen = true;
		if (edgeStart.edge === 'top' && dy > SWIPE_PX) controlOpen = true;
		edgeStart = null;
	}

	let orbRadius = $state(150);

	// --- Overlays: background goes inert (no Tab escape, no stray clicks) and focus returns
	// to whatever opened the overlay once it closes.
	const overlayOpen = $derived(timelineOpen || controlOpen || ambientOpen);
	let focusBeforeOverlay: HTMLElement | null = null;
	$effect(() => {
		if (overlayOpen) {
			if (!focusBeforeOverlay && document.activeElement instanceof HTMLElement) {
				focusBeforeOverlay = document.activeElement;
			}
			return;
		}
		const target = focusBeforeOverlay;
		focusBeforeOverlay = null;
		if (target && target.isConnected) queueMicrotask(() => target.focus());
	});
	let orbitSelectedId = $state<string | null>(null);
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

	onMount(() => {
		const sync = () => (orbRadius = loungeRadius());
		sync();
		window.addEventListener('resize', sync);
		const tick = setInterval(() => (cardsTick = Date.now()), 15_000);
		return () => {
			window.removeEventListener('resize', sync);
			clearInterval(tick);
			clearHold();
		};
	});

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
				quality,
				mood: vizMood
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="lounge-stage"
	data-state={demo.state}
	data-hermes={demo.isHermesWorking ? '1' : '0'}
	onpointerdown={onStageDown}
	onpointerup={onStageUp}
>
	<div class="stage-bg" inert={overlayOpen}>
		<div class="glow-field" aria-hidden="true"></div>
		<canvas class="viz" bind:this={canvasEl} aria-hidden="true"></canvas>

		<button
			type="button"
			class="control-handle"
			aria-label={pt('control.open')}
			aria-expanded={controlOpen}
			onclick={() => (controlOpen = true)}
		>
			<span class="control-handle__bar" aria-hidden="true"></span>
			<span class="control-handle__meta">
				{demo.talkMode === 'handsfree' ? pt('mode.handsfree') : pt('mode.ptt')} · {getLocale().toUpperCase()}
				· {PROVIDER_LABELS[demo.provider ?? provider ?? 'xai']}
			</span>
		</button>

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

		<button
			type="button"
			class="orb talk"
			class:talk--cancel={demo.isHermesWorking}
			style:--orb-size="{orbRadius * 2}px"
			aria-pressed={pressed}
			aria-label={buttonLabel}
			aria-describedby="orb-hint"
			disabled={demo.buttonDisabled}
			onpointerdown={onOrbDown}
			onpointerup={onOrbUp}
			onpointercancel={onOrbCancel}
			onclick={onOrbClick}
		>
			<span class="brand">{persona.assistantName.toUpperCase()}</span>
			<span class="status" aria-live="polite">{demo.statusLabel}</span>
		</button>

		<TaskOrbit
			bind:selectedId={orbitSelectedId}
			tasks={demo.orbitTasks}
			radius={orbRadius}
			onCancel={(id) => void demo.cancelTask(id)}
			onSpeak={() => demo.speakPendingReports()}
		/>

		<div class="under-orb" style:--orb-size="{orbRadius * 2}px">
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
			{#if demo.pendingReportCount > 0 && !latestCards}
				<button type="button" class="report-chip" onclick={() => demo.speakPendingReports()}>
					<span class="report-chip__count">{demo.pendingReportCount}</span>
					{pt('status.resultsReady')}
				</button>
			{/if}
		</div>

		<div class="dock">
			{#if showMicPrimer}
				<MicPrimer onDismiss={dismissPrimer} assistantName={persona.assistantName} />
			{/if}

			{#if demo.pendingApproval}
				<!-- shown in .approval-layer, outside the inert background -->
			{:else if latestCards && !orbitSelectedId}
				<div class="cards-tray" transition:fade={{ duration: 180 }}>
					<ResultCards cards={latestCards.cards} compact row />
					<button
						type="button"
						class="cards-tray__dismiss"
						aria-label={pt('task.close')}
						onclick={() => (dismissedCardsId = latestCards!.id)}
					>
						<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"
							><path
								d="M6 6l12 12M18 6L6 18"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/></svg
						>
					</button>
				</div>
			{/if}

			<p class="orb-hint" id="orb-hint">{orbHint}</p>

			<div class="dock__row">
				<TextComposer
					enabled={demo.canSendText}
					onSend={(text) => demo.sendText(text)}
					assistantName={persona.assistantName}
				/>
				<button
					type="button"
					class="dock__timeline"
					aria-label={pt('timeline.open')}
					aria-expanded={timelineOpen}
					onclick={() => (timelineOpen = true)}
				>
					<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
						><path
							d="M4 6h16M4 12h16M4 18h10"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/></svg
					>
					{#if timeline.entries.length > 0}<span class="dock__dot" aria-hidden="true"></span>{/if}
				</button>
			</div>
			<span class="home-bar" aria-hidden="true"></span>
		</div>
	</div>

	{#if demo.pendingApproval}
		<div class="approval-layer">
			<ApprovalCard
				approval={demo.pendingApproval}
				assistantName={persona.assistantName}
				voiceApproval={speechInTimeline || persona.reviewConversationForMemory}
				onApprove={() => void demo.approve(demo.pendingApproval!.id)}
				onDecline={() => demo.decline(demo.pendingApproval!.id)}
			/>
		</div>
	{/if}

	<TimelineSheet
		open={timelineOpen}
		entries={timeline.entries}
		assistantName={persona.assistantName}
		onClose={() => (timelineOpen = false)}
		onClear={() => timeline.clear()}
	/>

	<ControlCenter
		open={controlOpen}
		talkMode={demo.talkMode}
		provider={demo.provider ?? provider ?? 'xai'}
		{isOwner}
		{confirmActions}
		{speechInTimeline}
		onClose={() => (controlOpen = false)}
		onTalkMode={(m) => demo.setTalkMode(m)}
		onOpenSettings={(section) => {
			controlOpen = false;
			openSettings(section);
		}}
		onAmbient={() => {
			controlOpen = false;
			ambientOpen = true;
		}}
		onConfirmActions={setConfirmActions}
		onSpeechInTimeline={setSpeechInTimeline}
	/>

	{#if ambientOpen}
		<AmbientMode
			assistantName={persona.assistantName}
			voiceState={demo.state}
			statusLabel={demo.statusLabel}
			readyCount={demo.pendingReportCount}
			onToggleTalk={() => demo.toggle()}
			onSpeakReady={() => demo.speakPendingReports()}
			onExit={() => (ambientOpen = false)}
		/>
	{/if}

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

	.control-handle {
		position: absolute;
		z-index: 5;
		top: max(0.6rem, env(safe-area-inset-top));
		left: 50%;
		translate: -50% 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.75rem;
		padding: 0.2rem 1rem;
		border: none;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.74rem;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.control-handle__bar {
		width: 2.75rem;
		height: 5px;
		border-radius: 3px;
		background: rgba(202, 253, 255, 0.28);
		transition: background 0.15s ease;
	}

	.control-handle:hover .control-handle__bar {
		background: rgba(202, 253, 255, 0.5);
	}

	.control-handle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 0.75rem;
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

	.orb {
		position: absolute;
		z-index: 3;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		width: var(--orb-size, 300px);
		height: var(--orb-size, 300px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.65rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--ink);
		font: inherit;
		text-align: center;
		cursor: pointer;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
	}

	.orb:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 6px;
	}

	.orb:disabled {
		cursor: wait;
	}

	.orb.talk--cancel .status {
		color: #ffd4d4;
	}

	.under-orb {
		position: absolute;
		z-index: 3;
		left: 50%;
		top: calc(50% + var(--orb-size, 300px) / 2 + 1rem);
		translate: -50% 0;
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

	.report-chip {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: -0.15rem 0 0;
		min-height: 1.8rem;
		padding: 0.22rem 0.7rem;
		border: 1px solid rgba(94, 231, 255, 0.4);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.7);
		backdrop-filter: blur(6px);
		color: var(--ink);
		font: inherit;
		font-size: 0.74rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}

	.report-chip:hover {
		border-color: var(--cyan);
		background: rgba(8, 36, 40, 0.85);
	}

	.report-chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.report-chip__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: #04191c;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.dock {
		position: absolute;
		z-index: 4;
		left: 0;
		right: 0;
		bottom: max(0.5rem, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 0 1rem;
	}

	.dock__row {
		width: min(32rem, 100%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.dock__row :global(.composer) {
		flex: 1;
		min-width: 0;
	}

	.dock__timeline {
		position: relative;
		flex: none;
		width: 3rem;
		height: 3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(142, 184, 188, 0.35);
		border-radius: 999px;
		background: rgba(3, 10, 12, 0.55);
		color: var(--cyan);
		cursor: pointer;
	}

	.dock__timeline:focus-visible,
	.cards-tray__dismiss:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.dock__dot {
		position: absolute;
		top: 0.55rem;
		right: 0.6rem;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
	}

	.orb-hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.74rem;
		letter-spacing: 0.04em;
		text-align: center;
		opacity: 0.85;
	}

	.home-bar {
		width: 7.5rem;
		height: 5px;
		border-radius: 3px;
		background: rgba(202, 253, 255, 0.18);
	}

	.cards-tray {
		position: relative;
		width: min(32rem, 100%);
	}

	.cards-tray__dismiss {
		position: absolute;
		top: -0.9rem;
		right: -0.3rem;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(142, 184, 188, 0.35);
		border-radius: 999px;
		background: #0a1b1e;
		color: var(--muted);
		cursor: pointer;
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

	/* Wrapper only exists to make the background inert while an overlay is open. */
	.stage-bg {
		display: contents;
	}

	/* Above every overlay (and outside the inert background) so an approval can always be
	   answered, even with the timeline or ambient mode open. */
	.approval-layer {
		position: fixed;
		z-index: 31;
		left: 50%;
		bottom: calc(7.5rem + env(safe-area-inset-bottom));
		translate: -50% 0;
		width: min(26rem, calc(100vw - 2rem));
	}
</style>
