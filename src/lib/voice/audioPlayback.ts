import { deltaBase64ToPlaybackFloat } from './pcm';

export type PlaybackHandle = {
	analyser: AnalyserNode;
	enqueueBase64Pcm16(b64: string): void;
	interrupt(): void;
	readonly playing: boolean;
	whenIdle(): Promise<void>;
	destroy(): void;
};

/**
 * Queue/schedule base64 PCM16 (24 kHz) deltas into AudioContext with a write-cursor.
 * Analyser sits in the audible path for Lazic while speaking.
 */
export function createPlayback(ctx: AudioContext): PlaybackHandle {
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.35;
	analyser.minDecibels = -85;
	analyser.maxDecibels = -28;
	analyser.connect(ctx.destination);

	let nextStartTime = 0;
	let activeSources = 0;
	const sources = new Set<AudioBufferSourceNode>();
	let idleWaiters: Array<() => void> = [];
	let destroyed = false;

	function notifyIdleIfNeeded() {
		if (activeSources > 0) return;
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const w of waiters) w();
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
		notifyIdleIfNeeded();
	}

	return {
		analyser,
		enqueueBase64Pcm16,
		interrupt,
		get playing() {
			return activeSources > 0;
		},
		whenIdle() {
			if (activeSources === 0) return Promise.resolve();
			return new Promise<void>((resolve) => {
				idleWaiters.push(resolve);
			});
		},
		destroy() {
			destroyed = true;
			interrupt();
			try {
				analyser.disconnect();
			} catch {
				/* ignore */
			}
		}
	};
}
