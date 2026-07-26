import { arrayBufferToBase64, PROVIDER_PCM_RATE, resampleLinear } from './pcm';

export type CaptureHandle = {
	stream: MediaStream;
	analyser: AnalyserNode;
	start(): void;
	stop(): void;
	setOnPcm(cb: (base64: string) => void): void;
	destroy(): void;
};

/**
 * Mic → Analyser(512) → AudioWorklet → zero-gain sink.
 * Worklet posts Int16 frames; we base64 (and resample to 24 kHz if needed) for append.
 */
export async function createMicCapture(ctx: AudioContext): Promise<CaptureHandle> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			echoCancellation: true,
			noiseSuppression: true,
			channelCount: 1
		}
	});

	await ctx.audioWorklet.addModule('/audio/pcm-capture-processor.js');

	const source = ctx.createMediaStreamSource(stream);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.4;
	analyser.minDecibels = -85;
	analyser.maxDecibels = -28;

	const worklet = new AudioWorkletNode(ctx, 'pcm-capture-processor');
	const silent = ctx.createGain();
	silent.gain.value = 0;

	source.connect(analyser);
	analyser.connect(worklet);
	worklet.connect(silent);
	silent.connect(ctx.destination);

	let onPcm: ((base64: string) => void) | null = null;
	let posting = false;
	const ctxRate = ctx.sampleRate;

	worklet.port.onmessage = (ev: MessageEvent) => {
		if (!posting || !onPcm) return;
		const data = ev.data as { pcm16?: ArrayBuffer } | null;
		if (!data?.pcm16) return;

		const int16 = new Int16Array(data.pcm16);
		const float = new Float32Array(int16.length);
		for (let i = 0; i < int16.length; i++) {
			float[i] = int16[i]! / (int16[i]! < 0 ? 0x8000 : 0x7fff);
		}
		const atProviderRate =
			ctxRate === PROVIDER_PCM_RATE ? float : resampleLinear(float, ctxRate, PROVIDER_PCM_RATE);

		const pcmBuf = new ArrayBuffer(atProviderRate.length * 2);
		const view = new DataView(pcmBuf);
		for (let i = 0; i < atProviderRate.length; i++) {
			const s = Math.max(-1, Math.min(1, atProviderRate[i]!));
			view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		}
		onPcm(arrayBufferToBase64(pcmBuf));
	};

	return {
		stream,
		analyser,
		start() {
			posting = true;
			worklet.port.postMessage({ type: 'start' });
			for (const t of stream.getAudioTracks()) t.enabled = true;
		},
		stop() {
			posting = false;
			worklet.port.postMessage({ type: 'stop' });
			for (const t of stream.getAudioTracks()) t.enabled = false;
		},
		setOnPcm(cb) {
			onPcm = cb;
		},
		destroy() {
			posting = false;
			onPcm = null;
			try {
				worklet.port.postMessage({ type: 'stop' });
			} catch {
				/* ignore */
			}
			try {
				source.disconnect();
				analyser.disconnect();
				worklet.disconnect();
				silent.disconnect();
			} catch {
				/* ignore */
			}
			for (const t of stream.getTracks()) t.stop();
		}
	};
}
