/**
 * AudioWorkletProcessor — float mono frames → Int16 PCM chunks (~20–40 ms).
 * Posts transferable ArrayBuffers to the main thread; no mic monitor audio.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._active = false;
		this._pending = [];
		this._pendingSamples = 0;
		// ~30 ms at typical rates; actual rate comes from sampleRate global
		this._targetSamples = Math.max(128, Math.round(sampleRate * 0.03));
		this.port.onmessage = (ev) => {
			const msg = ev.data;
			if (!msg || typeof msg !== 'object') return;
			if (msg.type === 'start') this._active = true;
			if (msg.type === 'stop') {
				this._active = false;
				this._pending = [];
				this._pendingSamples = 0;
			}
		};
	}

	process(inputs) {
		const input = inputs[0];
		if (!this._active || !input || !input[0]) return true;

		const channel = input[0];
		this._pending.push(Float32Array.from(channel));
		this._pendingSamples += channel.length;

		while (this._pendingSamples >= this._targetSamples) {
			const merged = new Float32Array(this._targetSamples);
			let offset = 0;
			while (offset < this._targetSamples && this._pending.length) {
				const head = this._pending[0];
				const need = this._targetSamples - offset;
				if (head.length <= need) {
					merged.set(head, offset);
					offset += head.length;
					this._pending.shift();
					this._pendingSamples -= head.length;
				} else {
					merged.set(head.subarray(0, need), offset);
					this._pending[0] = head.subarray(need);
					this._pendingSamples -= need;
					offset += need;
				}
			}

			const pcm16 = new Int16Array(merged.length);
			for (let i = 0; i < merged.length; i++) {
				const s = Math.max(-1, Math.min(1, merged[i]));
				pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
			}
			this.port.postMessage({ pcm16: pcm16.buffer }, [pcm16.buffer]);
		}

		return true;
	}
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
