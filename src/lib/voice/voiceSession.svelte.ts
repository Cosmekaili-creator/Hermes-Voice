import { pulse } from '$lib/haptics';
import { createMicCapture, type CaptureHandle } from './audioCapture';
import { createPlayback, type PlaybackHandle } from './audioPlayback';
import { createRealtimeClient, type RealtimeClient, type RealtimeServerEvent } from './realtimeClient';

export type VoiceDemoState = 'idle' | 'listening' | 'thinking' | 'speaking';

const LABELS = {
	idle: 'Press to talk',
	listening: 'Listening… press again when finished',
	thinking: 'One moment…',
	hermesWorking: 'Hermes is working…',
	hermesStill: 'Still on it…',
	hermesAlmost: 'Almost there…',
	speaking: 'Hermes speaking…',
	connecting: 'Connecting…',
	cancel: 'Cancel',
	cancelArm: 'Tap again to cancel',
	cancelled: 'Cancelled'
} as const;

const WAIT_PHRASES = [LABELS.hermesWorking, LABELS.hermesStill, LABELS.hermesAlmost] as const;

const THINK_TIMEOUT_MS = 18000;
const HERMES_BRIDGE_TIMEOUT_MS = 150_000;
const TOKEN_SKEW_MS = 30_000;
const CANCEL_ARM_MS = 900;
const WAIT_TICK_MS = 1000;
const WAIT_PHRASE_EVERY_TICKS = 4;
const WARM_RECHECK_MS = 60_000;

type MintResult = { value: string; expires_at: number };

/**
 * Real voice session orchestrator (Phase 4 + Phase 7 cancel/warm/wait/haptics).
 */
export function createVoiceDemo(getKey: () => string = () => '') {
	let state = $state<VoiceDemoState>('idle');
	let statusOverride = $state<string | null>(null);
	let busy = $state(false);
	let needsReconnect = $state(false);
	let hermesBridgeActive = $state(false);
	let cancelArmed = $state(false);
	/** Elapsed seconds while Hermes works; null when not in a wait. */
	let waitElapsedSec = $state<number | null>(null);
	/** Blocks response.done → idle until post-tool audio starts (or fail). */
	let suppressIdleForTool = false;
	let micAnalyser = $state<AnalyserNode | null>(null);
	let playAnalyser = $state<AnalyserNode | null>(null);

	const statusLabel = $derived.by(() => {
		if (statusOverride) return statusOverride;
		if (busy && state === 'idle') return LABELS.connecting;
		if (hermesBridgeActive && state === 'thinking') return LABELS.hermesWorking;
		switch (state) {
			case 'idle':
				return LABELS.idle;
			case 'listening':
				return LABELS.listening;
			case 'thinking':
				return LABELS.thinking;
			case 'speaking':
				return LABELS.speaking;
		}
	});

	const buttonDisabled = $derived((busy || state === 'thinking') && !hermesBridgeActive);
	const isHermesWorking = $derived(hermesBridgeActive);

	let audioCtx: AudioContext | null = null;
	let capture: CaptureHandle | null = null;
	let playback: PlaybackHandle | null = null;
	let client: RealtimeClient | null = null;
	let token: MintResult | null = null;
	let thinkTimer: ReturnType<typeof setTimeout> | null = null;
	let cancelArmTimer: ReturnType<typeof setTimeout> | null = null;
	let waitTickTimer: ReturnType<typeof setInterval> | null = null;
	let warmRecheckTimer: ReturnType<typeof setInterval> | null = null;
	let hermesAbort: AbortController | null = null;
	let hermesStartedAt = 0;
	let waitPhraseIndex = 0;
	let waitTickCount = 0;
	let warmInFlight: Promise<void> | null = null;
	let realtimeInFlight: Promise<RealtimeClient> | null = null;
	let turnId = 0;
	let destroyed = false;
	const voiceSessionId =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `voice-${Date.now()}`;

	function clearThinkTimer() {
		if (thinkTimer !== null) {
			clearTimeout(thinkTimer);
			thinkTimer = null;
		}
	}

	function clearCancelArm() {
		cancelArmed = false;
		if (cancelArmTimer !== null) {
			clearTimeout(cancelArmTimer);
			cancelArmTimer = null;
		}
	}

	function clearWaitRotation() {
		if (waitTickTimer !== null) {
			clearInterval(waitTickTimer);
			waitTickTimer = null;
		}
		waitPhraseIndex = 0;
		waitTickCount = 0;
		hermesStartedAt = 0;
		waitElapsedSec = null;
	}

	function clearWarmRecheck() {
		if (warmRecheckTimer !== null) {
			clearInterval(warmRecheckTimer);
			warmRecheckTimer = null;
		}
	}

	function updateWaitStatus() {
		if (!hermesBridgeActive || destroyed || cancelArmed) return;
		waitElapsedSec = Math.max(0, Math.floor((Date.now() - hermesStartedAt) / 1000));
		statusOverride = WAIT_PHRASES[waitPhraseIndex % WAIT_PHRASES.length];
	}

	function startWaitRotation() {
		clearWaitRotation();
		hermesStartedAt = Date.now();
		waitPhraseIndex = 0;
		waitTickCount = 0;
		updateWaitStatus();
		waitTickTimer = setInterval(() => {
			if (!hermesBridgeActive || destroyed) return;
			waitTickCount += 1;
			waitElapsedSec = Math.max(0, Math.floor((Date.now() - hermesStartedAt) / 1000));
			if (waitTickCount % WAIT_PHRASE_EVERY_TICKS === 0) {
				waitPhraseIndex += 1;
			}
			if (!cancelArmed) {
				statusOverride = WAIT_PHRASES[waitPhraseIndex % WAIT_PHRASES.length];
			}
		}, WAIT_TICK_MS);
	}

	function endHermesBridgeUi() {
		hermesBridgeActive = false;
		clearCancelArm();
		clearWaitRotation();
		if (hermesAbort) {
			hermesAbort = null;
		}
	}

	function setIdle(message?: string, reconnect = false) {
		clearThinkTimer();
		clearCancelArm();
		clearWaitRotation();
		if (hermesAbort) {
			try {
				hermesAbort.abort();
			} catch {
				/* ignore */
			}
			hermesAbort = null;
		}
		busy = false;
		hermesBridgeActive = false;
		suppressIdleForTool = false;
		state = 'idle';
		statusOverride = message ?? null;
		needsReconnect = reconnect;
		capture?.stop();
	}

	function fail(message: string, opts?: { reconnect?: boolean }) {
		capture?.stop();
		playback?.interrupt();
		try {
			client?.clearInputBuffer();
		} catch {
			/* ignore */
		}
		if (opts?.reconnect) {
			try {
				client?.close();
			} catch {
				/* ignore */
			}
			client = null;
			token = null;
		}
		setIdle(message, opts?.reconnect === true);
	}

	function confirmCancelHermes() {
		pulse([15, 50, 15]);
		try {
			hermesAbort?.abort();
		} catch {
			/* ignore */
		}
		hermesAbort = null;
		turnId += 1;
		clearThinkTimer();
		clearCancelArm();
		clearWaitRotation();
		suppressIdleForTool = false;
		hermesBridgeActive = false;
		busy = false;
		try {
			client?.cancelResponse();
			client?.clearInputBuffer();
		} catch {
			/* ignore */
		}
		playback?.interrupt();
		setIdle(LABELS.cancelled);
	}

	function armOrCancelHermes() {
		if (!hermesBridgeActive || destroyed) return;
		if (cancelArmed) {
			confirmCancelHermes();
			return;
		}
		pulse(6);
		cancelArmed = true;
		statusOverride = LABELS.cancelArm;
		if (cancelArmTimer !== null) clearTimeout(cancelArmTimer);
		cancelArmTimer = setTimeout(() => {
			cancelArmTimer = null;
			if (!hermesBridgeActive || destroyed) return;
			cancelArmed = false;
			updateWaitStatus();
		}, CANCEL_ARM_MS);
	}

	async function ensureAudio(): Promise<AudioContext> {
		if (!audioCtx) {
			try {
				audioCtx = new AudioContext({ sampleRate: 24000 });
			} catch {
				audioCtx = new AudioContext();
			}
		}
		if (audioCtx.state === 'suspended') {
			await audioCtx.resume();
		}
		if (!playback) {
			playback = createPlayback(audioCtx);
			playAnalyser = playback.analyser;
		}
		return audioCtx;
	}

	async function ensureCapture(ctx: AudioContext): Promise<CaptureHandle> {
		if (capture) return capture;
		const handle = await createMicCapture(ctx);
		capture = handle;
		micAnalyser = handle.analyser;
		handle.setOnPcm((b64) => {
			if (destroyed || state !== 'listening') return;
			if (!client?.ready) return;
			client.appendAudio(b64);
		});
		return handle;
	}

	function tokenFresh(): boolean {
		if (!token?.value) return false;
		if (!Number.isFinite(token.expires_at)) return true;
		return Date.now() < token.expires_at * 1000 - TOKEN_SKEW_MS;
	}

	async function mintSession(): Promise<MintResult> {
		const res = await fetch('/api/session', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: '{}'
		});
		if (!res.ok) {
			if (res.status === 401) throw new Error('Session unauthorized');
			if (res.status === 500) throw new Error('Session unavailable');
			throw new Error('Session request failed');
		}
		const body = (await res.json()) as { value?: string; expires_at?: number };
		if (typeof body.value !== 'string' || body.value.length === 0) {
			throw new Error('Session unavailable');
		}
		return {
			value: body.value,
			expires_at: typeof body.expires_at === 'number' ? body.expires_at : 0
		};
	}

	async function runHermesBridge(callId: string, request: string, myTurn: number) {
		const k = getKey().trim();
		let output = 'Hermes unavailable: unknown error';
		const ac = new AbortController();
		hermesAbort = ac;

		try {
			await playback?.whenIdle();
			if (destroyed || myTurn !== turnId) return;

			const res = await fetch('/api/hermes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				signal: ac.signal,
				body: JSON.stringify({
					...(k ? { k } : {}),
					request,
					session_id: voiceSessionId
				})
			});
			if (!res.ok) {
				output =
					res.status === 504
						? 'Hermes unavailable: timeout'
						: res.status === 499
							? 'Cancelled'
							: `Hermes unavailable: HTTP ${res.status}`;
			} else {
				const body = (await res.json()) as { text?: string };
				const text = typeof body.text === 'string' ? body.text.trim() : '';
				output = text || 'Hermes returned an empty reply.';
			}
		} catch (err) {
			if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
				return;
			}
			output = 'Hermes unavailable: network error';
		} finally {
			if (hermesAbort === ac) hermesAbort = null;
		}

		if (destroyed || myTurn !== turnId) return;
		if (output === 'Cancelled') return;

		try {
			client?.sendFunctionCallOutput(callId, output);
			await playback?.whenIdle();
			if (destroyed || myTurn !== turnId) return;
			client?.respond();
			endHermesBridgeUi();
			statusOverride = null;
			clearThinkTimer();
			thinkTimer = setTimeout(() => {
				if (destroyed || myTurn !== turnId) return;
				if (state === 'thinking') {
					fail('No reply — try again');
				}
			}, THINK_TIMEOUT_MS);
		} catch {
			fail('Could not continue after Hermes');
		}
	}

	function beginHermesWorkingUi(myTurn: number) {
		hermesBridgeActive = true;
		suppressIdleForTool = true;
		busy = true;
		state = 'thinking';
		clearCancelArm();
		startWaitRotation();
		clearThinkTimer();
		thinkTimer = setTimeout(() => {
			if (destroyed || myTurn !== turnId) return;
			if (hermesBridgeActive || suppressIdleForTool || state === 'thinking') {
				fail('Hermes took too long — try again');
			}
		}, HERMES_BRIDGE_TIMEOUT_MS);
	}

	function handleFunctionCallDone(event: RealtimeServerEvent, myTurn: number) {
		const name = typeof event.name === 'string' ? event.name : '';
		const callId = typeof event.call_id === 'string' ? event.call_id : '';

		beginHermesWorkingUi(myTurn);

		if (!callId) {
			fail('Voice tool error');
			return;
		}

		if (name !== 'ask_hermes') {
			void (async () => {
				try {
					await playback?.whenIdle();
					if (destroyed || myTurn !== turnId) return;
					client?.sendFunctionCallOutput(
						callId,
						`Hermes unavailable: unknown tool ${name || '(empty)'}`
					);
					await playback?.whenIdle();
					if (destroyed || myTurn !== turnId) return;
					client?.respond();
					endHermesBridgeUi();
					statusOverride = null;
				} catch {
					fail('Voice tool error');
				}
			})();
			return;
		}

		let request = '';
		try {
			const args =
				typeof event.arguments === 'string' ? (JSON.parse(event.arguments) as { request?: unknown }) : {};
			request = typeof args.request === 'string' ? args.request.trim() : '';
		} catch {
			request = '';
		}

		if (!request) {
			void (async () => {
				try {
					await playback?.whenIdle();
					if (destroyed || myTurn !== turnId) return;
					client?.sendFunctionCallOutput(callId, 'Hermes unavailable: missing request');
					await playback?.whenIdle();
					if (destroyed || myTurn !== turnId) return;
					client?.respond();
					endHermesBridgeUi();
					statusOverride = null;
				} catch {
					fail('Voice tool error');
				}
			})();
			return;
		}

		void runHermesBridge(callId, request, myTurn);
	}

	function handleServerEvent(event: RealtimeServerEvent, myTurn: number) {
		if (destroyed || myTurn !== turnId) return;

		switch (event.type) {
			case 'error': {
				const msg =
					(typeof event.error?.message === 'string' && event.error.message) || 'Voice error';
				fail(msg);
				return;
			}
			case 'response.function_call_arguments.delta':
				return;
			case 'response.function_call_arguments.done': {
				handleFunctionCallDone(event, myTurn);
				return;
			}
			case 'response.output_audio.delta': {
				if (typeof event.delta !== 'string' || !event.delta) return;
				if (state !== 'thinking' && state !== 'speaking') return;
				clearThinkTimer();
				busy = false;
				endHermesBridgeUi();
				suppressIdleForTool = false;
				state = 'speaking';
				statusOverride = null;
				playback?.enqueueBase64Pcm16(event.delta);
				return;
			}
			case 'response.done': {
				if (hermesBridgeActive || suppressIdleForTool) {
					return;
				}
				void (async () => {
					if (myTurn !== turnId) return;
					clearThinkTimer();
					await playback?.whenIdle();
					if (destroyed || myTurn !== turnId) return;
					if (hermesBridgeActive || suppressIdleForTool) return;
					if (state === 'speaking' || state === 'thinking') {
						setIdle();
					}
				})();
				return;
			}
			default:
				return;
		}
	}

	async function ensureRealtime(): Promise<RealtimeClient> {
		if (client?.open && client.ready && tokenFresh()) return client;
		if (realtimeInFlight) return realtimeInFlight;

		realtimeInFlight = (async () => {
			if (client?.open && client.ready && tokenFresh()) return client;

			client?.close();
			client = null;

			token = await mintSession();
			if (destroyed) throw new Error('destroyed');
			const rt = createRealtimeClient({
				onEvent: (ev) => handleServerEvent(ev, turnId),
				onError: (message) => {
					if (destroyed) return;
					if (state !== 'idle') fail(message);
				},
				onClose: () => {
					if (destroyed) return;
					if (state === 'listening' || state === 'thinking' || state === 'speaking') {
						fail('Connection lost — press to reconnect', { reconnect: true });
					}
				}
			});
			await rt.connect(token.value);
			if (destroyed) {
				rt.close();
				throw new Error('destroyed');
			}
			client = rt;
			return rt;
		})();

		try {
			return await realtimeInFlight;
		} finally {
			realtimeInFlight = null;
		}
	}

	async function warm(): Promise<void> {
		if (destroyed) return;
		if (busy || state !== 'idle' || hermesBridgeActive) return;
		if (warmInFlight) return warmInFlight;

		warmInFlight = (async () => {
			try {
				// Soft-touch AudioContext only if already running — never block mint on resume()
				if (audioCtx?.state === 'running' && !playback) {
					playback = createPlayback(audioCtx);
					playAnalyser = playback.analyser;
				} else if (!audioCtx) {
					try {
						audioCtx = new AudioContext({ sampleRate: 24000 });
						if (audioCtx.state === 'running') {
							playback = createPlayback(audioCtx);
							playAnalyser = playback.analyser;
						}
						// If suspended, leave it — startListening will resume on gesture
					} catch {
						/* ignore */
					}
				}
				if (destroyed || busy || state !== 'idle' || hermesBridgeActive) return;
				if (!tokenFresh() || !client?.open || !client.ready) {
					await ensureRealtime();
				}
			} catch {
				/* silent — startListening surfaces errors */
			} finally {
				warmInFlight = null;
			}
		})();

		if (!warmRecheckTimer) {
			warmRecheckTimer = setInterval(() => {
				if (destroyed) return;
				if (busy || state !== 'idle' || hermesBridgeActive) return;
				if (tokenFresh() && client?.open && client.ready) return;
				void warm();
			}, WARM_RECHECK_MS);
		}

		return warmInFlight;
	}

	async function startListening() {
		if (destroyed || busy || state !== 'idle') return;

		busy = true;
		statusOverride = null;
		turnId += 1;
		const myTurn = turnId;

		try {
			if (warmInFlight) {
				try {
					await warmInFlight;
				} catch {
					/* warm errors are silent; we surface connect failures below */
				}
			}
			if (destroyed || myTurn !== turnId) {
				busy = false;
				return;
			}

			const ctx = await ensureAudio();
			const mic = await ensureCapture(ctx);
			await ensureRealtime();
			if (destroyed || myTurn !== turnId) {
				busy = false;
				return;
			}

			playback?.interrupt();
			mic.start();
			busy = false;
			needsReconnect = false;
			state = 'listening';
			statusOverride = null;
			pulse(12);
		} catch (err) {
			if (destroyed || myTurn !== turnId) {
				busy = false;
				return;
			}
			const name = err instanceof DOMException ? err.name : '';
			if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
				fail('Microphone denied — allow access in the browser, then try again');
				return;
			}
			const message = err instanceof Error ? err.message : 'Could not start voice';
			const reconnect =
				/websocket|session|connect|unauthorized|network|destroyed/i.test(message) ||
				message === 'Session request failed' ||
				message === 'Session unavailable';
			fail(message === 'destroyed' ? 'Could not start voice' : message, { reconnect });
		}
	}

	function finishListening() {
		if (state !== 'listening' || !client?.ready) return;

		turnId += 1;
		const myTurn = turnId;
		capture?.stop();
		busy = true;
		state = 'thinking';
		statusOverride = null;
		pulse(8);

		try {
			client.commitAndRespond();
		} catch {
			fail('Could not send audio');
			return;
		}

		clearThinkTimer();
		thinkTimer = setTimeout(() => {
			if (destroyed || myTurn !== turnId) return;
			if (state === 'thinking' && !hermesBridgeActive) {
				fail('No reply — try again');
			}
		}, THINK_TIMEOUT_MS);
	}

	function interruptSpeaking() {
		if (state !== 'speaking') return;
		turnId += 1;
		clearThinkTimer();
		endHermesBridgeUi();
		suppressIdleForTool = false;
		pulse([10, 40, 10]);
		try {
			client?.cancelResponse();
			client?.clearInputBuffer();
		} catch {
			/* ignore */
		}
		playback?.interrupt();
		setIdle();
	}

	function toggle() {
		if (destroyed) return;
		if (hermesBridgeActive) {
			armOrCancelHermes();
			return;
		}
		if (busy || state === 'thinking') return;

		if (state === 'speaking') {
			interruptSpeaking();
			return;
		}
		if (state === 'listening') {
			finishListening();
			return;
		}
		void startListening();
	}

	function destroy() {
		destroyed = true;
		busy = false;
		clearThinkTimer();
		clearCancelArm();
		clearWaitRotation();
		clearWarmRecheck();
		try {
			hermesAbort?.abort();
		} catch {
			/* ignore */
		}
		hermesAbort = null;
		hermesBridgeActive = false;
		suppressIdleForTool = false;
		needsReconnect = false;
		warmInFlight = null;
		realtimeInFlight = null;
		capture?.stop();
		capture?.destroy();
		capture = null;
		playback?.destroy();
		playback = null;
		client?.close();
		client = null;
		token = null;
		micAnalyser = null;
		playAnalyser = null;
		if (audioCtx) {
			void audioCtx.close();
			audioCtx = null;
		}
	}

	return {
		get state() {
			return state;
		},
		get statusLabel() {
			return statusLabel;
		},
		get buttonDisabled() {
			return buttonDisabled;
		},
		get busy() {
			return busy;
		},
		get needsReconnect() {
			return needsReconnect;
		},
		get isHermesWorking() {
			return isHermesWorking;
		},
		get cancelArmed() {
			return cancelArmed;
		},
		get waitElapsedSec() {
			return waitElapsedSec;
		},
		get micAnalyser() {
			return micAnalyser;
		},
		get playAnalyser() {
			return playAnalyser;
		},
		warm,
		toggle,
		destroy
	};
}

export type VoiceDemo = ReturnType<typeof createVoiceDemo>;
