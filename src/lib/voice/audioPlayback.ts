import { deltaBase64ToPlaybackFloat } from './pcm';

export type PlaybackHandle = {
	analyser: AnalyserNode;
	/**
	 * Dedicated analyser tap for OpenAI WebRTC remote audio (Lazic viz). Fed from the
	 * remote MediaStream but never connected to `ctx.destination` — actual audible
	 * playback of the remote stream happens via a detached `<audio>` element, not
	 * Web Audio, so this node exists purely for visualization.
	 */
	remoteAnalyser: AnalyserNode;
	enqueueBase64Pcm16(b64: string): void;
	/** Attach OpenAI WebRTC remote audio: plays via a hidden <audio> element, taps remoteAnalyser for Lazic viz. */
	attachRemoteStream(stream: MediaStream): void;
	/** Mark remote media as active/idle for whenIdle (no PCM deltas on WebRTC). */
	setRemoteActive(active: boolean): void;
	interrupt(): void;
	readonly playing: boolean;
	/** Seconds of PCM still queued ahead of the AudioContext playhead (0 for WebRTC). */
	readonly bufferedAheadSec: number;
	/**
	 * 0..1 progress through the current PCM utterance (playhead vs queue end).
	 * 0 when idle / WebRTC remote-only.
	 */
	readonly speakProgress: number;
	whenIdle(): Promise<void>;
	destroy(): void;
};

/**
 * Queue/schedule base64 PCM16 (24 kHz) deltas into AudioContext with a write-cursor,
 * plus optional WebRTC remote MediaStream sink for OpenAI.
 * Analyser sits in the audible path for Lazic while speaking.
 */
export function createPlayback(ctx: AudioContext): PlaybackHandle {
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.35;
	analyser.minDecibels = -85;
	analyser.maxDecibels = -28;
	analyser.connect(ctx.destination);

	// Dedicated tap for OpenAI WebRTC remote audio. Deliberately NOT connected to
	// ctx.destination: actual audible output for the remote stream comes from a
	// plain <audio> element (see attachRemoteStream) to avoid the well-documented
	// cross-browser footgun where a remote WebRTC track piped only through Web
	// Audio can render silently. Routing it into the shared `analyser` above (which
	// is wired to destination for the xAI PCM path) would also double-play it.
	const remoteAnalyser = ctx.createAnalyser();
	remoteAnalyser.fftSize = analyser.fftSize;
	remoteAnalyser.smoothingTimeConstant = analyser.smoothingTimeConstant;
	remoteAnalyser.minDecibels = analyser.minDecibels;
	remoteAnalyser.maxDecibels = analyser.maxDecibels;

	let nextStartTime = 0;
	/** AudioContext time when the current PCM utterance's first chunk was scheduled. */
	let utteranceOrigin = 0;
	let activeSources = 0;
	const sources = new Set<AudioBufferSourceNode>();
	let idleWaiters: Array<() => void> = [];
	let destroyed = false;

	let remoteSource: MediaStreamAudioSourceNode | null = null;
	let remoteGain: GainNode | null = null;
	let remoteActive = false;
	/** Actual audible sink for OpenAI WebRTC remote audio (lazily created, reused). */
	let remoteAudioEl: HTMLAudioElement | null = null;

	function notifyIdleIfNeeded() {
		if (activeSources > 0 || remoteActive) return;
		utteranceOrigin = 0;
		nextStartTime = 0;
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const w of waiters) w();
	}

	function detachRemote() {
		if (remoteSource) {
			try {
				remoteSource.disconnect();
			} catch {
				/* ignore */
			}
			remoteSource = null;
		}
		if (remoteGain) {
			try {
				remoteGain.disconnect();
			} catch {
				/* ignore */
			}
			remoteGain = null;
		}
		if (remoteAudioEl) {
			try {
				remoteAudioEl.pause();
			} catch {
				/* ignore */
			}
			try {
				remoteAudioEl.srcObject = null;
			} catch {
				/* ignore */
			}
		}
	}

	function enqueueBase64Pcm16(b64: string) {
		if (destroyed || !b64) return;
		const samples = deltaBase64ToPlaybackFloat(b64, ctx.sampleRate);
		if (samples.length === 0) return;

		const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
		// Copy into a fresh ArrayBuffer-backed view (TS: Float32Array<ArrayBuffer>)
		const channel = new Float32Array(samples.length);
		channel.set(samples);
		buffer.copyToChannel(channel, 0);

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(analyser);

		const startAt = Math.max(ctx.currentTime + 0.02, nextStartTime);
		// Keep origin across back-to-back chunks so speakProgress stays continuous.
		if (utteranceOrigin <= 0) {
			utteranceOrigin = startAt;
		}
		nextStartTime = startAt + buffer.duration;
		activeSources += 1;
		sources.add(source);

		source.onended = () => {
			sources.delete(source);
			activeSources = Math.max(0, activeSources - 1);
			try {
				source.disconnect();
			} catch {
				/* ignore */
			}
			notifyIdleIfNeeded();
		};

		source.start(startAt);
	}

	function attachRemoteStream(stream: MediaStream) {
		if (destroyed) return;
		detachRemote();
		try {
			// Actual audible playback: a plain <audio> element, not Web Audio. Piping a
			// remote WebRTC MediaStream only through Web Audio (createMediaStreamSource
			// -> ... -> ctx.destination) is a well-documented cross-browser footgun where
			// the track can render silently even though the connection is healthy.
			if (!remoteAudioEl) {
				remoteAudioEl = document.createElement('audio');
				remoteAudioEl.autoplay = true;
			}
			remoteAudioEl.srcObject = stream;
			try {
				const playResult = remoteAudioEl.play();
				if (playResult && typeof playResult.catch === 'function') {
					playResult.catch(() => {
						/* ignore — autoplay may reject before a user gesture elsewhere */
					});
				}
			} catch {
				/* ignore */
			}

			// Web Audio tap, for the Lazic visualizer only — feeds remoteAnalyser, which
			// is never connected to ctx.destination, so this never contributes to audible
			// output (avoiding double/echoed audio on top of the <audio> element above).
			remoteGain = ctx.createGain();
			remoteGain.gain.value = 1;
			remoteSource = ctx.createMediaStreamSource(stream);
			remoteSource.connect(remoteGain);
			remoteGain.connect(remoteAnalyser);

			// Keep the real audible sink's mute state consistent with the current
			// remoteActive flag immediately, so a fresh stream attach doesn't briefly
			// default to unmuted (or stay stuck muted) ahead of the next explicit
			// setRemoteActive call.
			if (remoteAudioEl) remoteAudioEl.muted = !remoteActive;
		} catch {
			detachRemote();
		}
	}

	function setRemoteActive(active: boolean) {
		remoteActive = active;
		if (remoteGain) {
			remoteGain.gain.value = active ? 1 : 0;
		}
		if (remoteAudioEl) remoteAudioEl.muted = !active;
		if (!active) notifyIdleIfNeeded();
	}

	function interrupt() {
		for (const source of sources) {
			try {
				source.onended = null;
				source.stop();
				source.disconnect();
			} catch {
				/* ignore */
			}
		}
		sources.clear();
		activeSources = 0;
		nextStartTime = 0;
		utteranceOrigin = 0;
		if (remoteGain) {
			remoteGain.gain.value = 0;
		}
		if (remoteAudioEl) remoteAudioEl.muted = true;
		remoteActive = false;
		notifyIdleIfNeeded();
	}

	return {
		analyser,
		remoteAnalyser,
		enqueueBase64Pcm16,
		attachRemoteStream,
		setRemoteActive,
		interrupt,
		get playing() {
			return activeSources > 0 || remoteActive;
		},
		get bufferedAheadSec() {
			if (remoteActive) return 0;
			const ahead = nextStartTime - ctx.currentTime;
			return ahead > 0 ? ahead : 0;
		},
		get speakProgress() {
			if (remoteActive || utteranceOrigin <= 0) return 0;
			const end = nextStartTime;
			if (end <= utteranceOrigin) return 0;
			const p = (ctx.currentTime - utteranceOrigin) / (end - utteranceOrigin);
			if (p <= 0) return 0;
			if (p >= 1) return 1;
			return p;
		},
		whenIdle() {
			if (activeSources === 0 && !remoteActive) return Promise.resolve();
			return new Promise<void>((resolve) => {
				idleWaiters.push(resolve);
			});
		},
		destroy() {
			destroyed = true;
			interrupt();
			detachRemote();
			if (remoteAudioEl) {
				try {
					remoteAudioEl.pause();
				} catch {
					/* ignore */
				}
				try {
					remoteAudioEl.srcObject = null;
				} catch {
					/* ignore */
				}
				remoteAudioEl = null;
			}
			try {
				analyser.disconnect();
			} catch {
				/* ignore */
			}
			try {
				remoteAnalyser.disconnect();
			} catch {
				/* ignore */
			}
		}
	};
}
