/**
 * PCM helpers for provider realtime audio (24 kHz). Prefer
 * AudioContext({ sampleRate: PROVIDER_PCM_RATE }); if the browser overrides the
 * rate, linearly resample to/from the provider rate.
 */

import { PCM_RATE } from '$lib/providers/xai/constants';

export const PROVIDER_PCM_RATE = PCM_RATE;

/** One-release alias — prefer PROVIDER_PCM_RATE. */
export const XAI_PCM_RATE = PROVIDER_PCM_RATE;

export function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
	const out = new ArrayBuffer(float32.length * 2);
	const view = new DataView(out);
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i]!));
		view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return out;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	const chunk = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunk) {
		const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
		binary += String.fromCharCode(...slice);
	}
	return btoa(binary);
}

export function base64ToInt16(base64: string): Int16Array {
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
	return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export function int16ToFloat32(samples: Int16Array): Float32Array {
	const out = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		out[i] = samples[i]! / (samples[i]! < 0 ? 0x8000 : 0x7fff);
	}
	return out;
}

/** Linear resample mono float samples from `fromRate` to `toRate`. */
export function resampleLinear(
	input: Float32Array,
	fromRate: number,
	toRate: number
): Float32Array {
	if (fromRate === toRate || input.length === 0) return input;
	const ratio = fromRate / toRate;
	const outLen = Math.max(1, Math.round(input.length / ratio));
	const out = new Float32Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const src = i * ratio;
		const i0 = Math.floor(src);
		const i1 = Math.min(i0 + 1, input.length - 1);
		const t = src - i0;
		out[i] = input[i0]! * (1 - t) + input[i1]! * t;
	}
	return out;
}

/** Convert worklet float frames at `ctxRate` → base64 PCM16 at provider rate for append. */
export function floatFramesToAppendBase64(float32: Float32Array, ctxRate: number): string {
	const atProviderRate =
		ctxRate === PROVIDER_PCM_RATE
			? float32
			: resampleLinear(float32, ctxRate, PROVIDER_PCM_RATE);
	return arrayBufferToBase64(floatTo16BitPCM(atProviderRate));
}

/** Decode a base64 PCM16 delta (provider rate) → float samples at `ctxRate` for playback. */
export function deltaBase64ToPlaybackFloat(base64: string, ctxRate: number): Float32Array {
	const int16 = base64ToInt16(base64);
	const f32 = int16ToFloat32(int16);
	return ctxRate === PROVIDER_PCM_RATE
		? f32
		: resampleLinear(f32, PROVIDER_PCM_RATE, ctxRate);
}
