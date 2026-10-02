export type VizQuality = 'high' | 'medium' | 'low';

/** Visual state of the orb — each gets its own motion language. */
export type VizMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type LazicLoungeOpts = {
	barWidth: number;
	barHeight: number;
	barSpacing: number;
	barColor: string;
	shadowBlur: number;
	shadowColor: string;
	radius: number;
	/** 0–1 energy for glow + particles (from voice state). */
	energy?: number;
	/** Animation time in ms (for particle drift). */
	nowMs?: number;
	/** Render budget — mobile defaults to low/medium. */
	quality?: VizQuality;
	/** listening: inward ripples · thinking: orbiting comet · speaking: bars · error: dim red. */
	mood?: VizMood;
};

/**
 * Bar index → FFT bin. Mirrored left/right and log-spaced from the bottom of the ring
 * (bass, where voice energy lives) to the top (presence/sibilance). A linear sweep put all
 * the energy on one arc, leaving the opposite side flat — the ring looked lopsided.
 */
export function ringBinFor(i: number, barNum: number, bins: number): number {
	const half = barNum / 2;
	const m = i <= half ? i / half : (barNum - i) / half; // 0 at the bottom, 1 at the top
	const lo = 2;
	const hi = Math.max(lo + 1, Math.min(bins - 1, Math.floor(bins * 0.6)));
	return Math.min(bins - 1, Math.round(lo * Math.pow(hi / lo, m)));
}

function meanLevel(data: Uint8Array): number {
	const n = Math.min(data.length, 96);
	if (n === 0) return 0;
	let sum = 0;
	for (let i = 1; i < n; i++) sum += data[i] ?? 0;
	return sum / ((n - 1) * 255);
}

type Particle = {
	angle: number;
	orbit: number;
	speed: number;
	size: number;
	phase: number;
	life: number;
};

const particles: Particle[] = [];
let lastSeed = 0;

/** Ring amplitude buffers for spatial + temporal smoothing. */
let ringDisplay: Float32Array | null = null;
let ringScratchA: Float32Array | null = null;
let ringScratchB: Float32Array | null = null;

/** Soft glow sprite — replaces per-particle shadowBlur (very expensive on mobile GPUs). */
let softDot: HTMLCanvasElement | null = null;

function getSoftDot(): HTMLCanvasElement {
	if (softDot) return softDot;
	const c = document.createElement('canvas');
	c.width = 64;
	c.height = 64;
	const g = c.getContext('2d');
	if (g) {
		const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
		grad.addColorStop(0.22, 'rgba(202, 253, 255, 0.85)');
		grad.addColorStop(0.55, 'rgba(94, 231, 255, 0.28)');
		grad.addColorStop(1, 'rgba(94, 231, 255, 0)');
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
	}
	softDot = c;
	return c;
}

const PARTICLE_BUDGET: Record<VizQuality, number> = {
	high: 36,
	medium: 28,
	low: 26
};

function ensureParticles(count: number, radius: number) {
	while (particles.length < count) {
		particles.push({
			angle: Math.random() * Math.PI * 2,
			orbit: radius * (0.55 + Math.random() * 0.9),
			speed: (0.00035 + Math.random() * 0.0011) * (Math.random() < 0.5 ? 1 : -1),
			size: 0.8 + Math.random() * 2.4,
			phase: Math.random() * Math.PI * 2,
			life: 0.35 + Math.random() * 0.65
		});
	}
	if (particles.length > count) particles.length = count;

	// Nudge orbits when radius changes a lot
	if (Math.abs(radius - lastSeed) > 40) {
		for (const p of particles) {
			p.orbit = radius * (0.55 + Math.random() * 0.9);
		}
		lastSeed = radius;
	}
}

/**
 * Lounge ring adapted from David Lazic's renderLounge
 * (https://github.com/DavidLazic/audio-visualizer) — canvas only, no author/title/time.
 *
 * Extended with soft bloom glow + orbiting particles. Motion always runs.
 *
 * Expects the context to already be in CSS-pixel space (caller handles DPR).
 */
export function drawLazicLounge(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	frequencyData: Uint8Array,
	opts: LazicLoungeOpts
) {
	const width = canvas.clientWidth || canvas.width;
	const height = canvas.clientHeight || canvas.height;
	const cx = width / 2;
	const cy = height / 2;
	const {
		barWidth,
		barHeight,
		barSpacing,
		barColor,
		shadowBlur,
		shadowColor,
		radius,
		energy = 0.4,
		nowMs = performance.now(),
		quality = 'high',
		mood = 'idle'
	} = opts;
	const isError = mood === 'error';

	const e = Math.min(1, Math.max(0, energy));
	const low = quality === 'low';
	const mid = quality === 'medium';
	ctx.clearRect(0, 0, width, height);

	// --- Soft core glow (behind the ring) ---
	const glowR = radius * (1.55 + e * 0.55);
	const core = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, glowR);
	core.addColorStop(
		0,
		isError ? `rgba(255, 170, 160, ${0.1 + e * 0.12})` : `rgba(202, 253, 255, ${0.14 + e * 0.22})`
	);
	core.addColorStop(
		0.35,
		isError ? `rgba(240, 110, 100, ${0.06 + e * 0.08})` : `rgba(94, 231, 255, ${0.08 + e * 0.12})`
	);
	core.addColorStop(0.7, `rgba(13, 58, 64, ${0.18 + e * 0.1})`);
	core.addColorStop(1, 'rgba(3, 10, 12, 0)');
	ctx.fillStyle = core;
	ctx.fillRect(0, 0, width, height);

	// Pulsing halo ring — shadow only on high quality
	ctx.beginPath();
	ctx.arc(cx, cy, radius * (0.92 + e * 0.06), 0, Math.PI * 2);
	ctx.strokeStyle = isError
		? `rgba(255, 150, 140, ${0.2 + e * 0.2})`
		: `rgba(202, 253, 255, ${0.12 + e * 0.28})`;
	ctx.lineWidth = 2 + e * 4;
	if (!low) {
		ctx.shadowBlur = mid ? 10 + e * 14 : 18 + e * 36;
		ctx.shadowColor = 'rgba(94, 231, 255, 0.85)';
	} else {
		ctx.shadowBlur = 0;
	}
	ctx.stroke();
	ctx.shadowBlur = 0;

	// Outer soft bloom — skip on low (CSS field already breathes)
	if (!low) {
		ctx.beginPath();
		ctx.arc(cx, cy, radius * (1.18 + e * 0.08), 0, Math.PI * 2);
		ctx.strokeStyle = `rgba(94, 231, 255, ${0.04 + e * 0.12})`;
		ctx.lineWidth = 10 + e * 14;
		ctx.shadowBlur = mid ? 12 + e * 16 : 28 + e * 40;
		ctx.shadowColor = '#5ee7ff';
		ctx.stroke();
		ctx.shadowBlur = 0;
	}

	// --- Orbiting particles (sprite, no shadowBlur) ---
	const particleCount = PARTICLE_BUDGET[quality];
	ensureParticles(particleCount, radius);
	const dot = getSoftDot();
	const energyMul = 0.7 + e * 1.6;

	for (const p of particles) {
		p.angle += p.speed * energyMul;
		const wobble = Math.sin(nowMs * 0.0022 + p.phase) * (6 + e * 14);
		const r = p.orbit + wobble;
		const x = cx + Math.cos(p.angle) * r;
		const y = cy + Math.sin(p.angle) * r;
		const alpha = (0.22 + e * 0.5) * p.life;
		const size = p.size * (0.75 + e * 0.9) * (low ? 1.15 : 1.6);

		ctx.globalAlpha = alpha;
		const d = size * 2;
		ctx.drawImage(dot, x - d, y - d, d * 2, d * 2);
	}
	ctx.globalAlpha = 1;

	// Sparks only on high quality when energetic
	if (!low && !mid && e > 0.45) {
		const sparks = Math.floor((e - 0.45) * 18);
		for (let i = 0; i < sparks; i++) {
			const a = (i / Math.max(1, sparks)) * Math.PI * 2 + nowMs * 0.001;
			const amp = frequencyData[(i * 17) % frequencyData.length] ?? 80;
			const rr = radius + 8 + (amp / 255) * (18 + e * 30);
			const x = cx + Math.cos(a) * rr;
			const y = cy + Math.sin(a) * rr;
			const s = 1.2 + e;
			ctx.globalAlpha = 0.25 + e * 0.45;
			ctx.drawImage(dot, x - s * 2, y - s * 2, s * 4, s * 4);
		}
		ctx.globalAlpha = 1;
	}

	// --- Mood overlays ---
	if (mood === 'listening') {
		// Inward ripples pulled toward the core by the user's voice level.
		const level = meanLevel(frequencyData);
		const rings = low ? 2 : 3;
		for (let k = 0; k < rings; k++) {
			const phase = (((nowMs * 0.00045 + k / rings) % 1) + 1) % 1;
			const rr = radius * (0.98 - phase * 0.55);
			ctx.beginPath();
			ctx.arc(cx, cy, rr, 0, Math.PI * 2);
			ctx.strokeStyle = `rgba(94, 231, 255, ${(1 - phase) * (0.12 + level * 0.65)})`;
			ctx.lineWidth = 1.5 + level * 3;
			ctx.stroke();
		}
	} else if (mood === 'thinking') {
		// A comet orbiting the ring: Hermes is working.
		const head = nowMs * 0.0032;
		const segs = low ? 10 : 18;
		const span = 1.1;
		for (let k = 0; k < segs; k++) {
			const a0 = head - (k / segs) * span;
			const a1 = head - ((k + 1) / segs) * span;
			ctx.beginPath();
			ctx.arc(cx, cy, radius * 1.04, a1, a0);
			ctx.strokeStyle = `rgba(202, 253, 255, ${(1 - k / segs) * 0.75})`;
			ctx.lineWidth = 3.5 * (1 - k / segs) + 0.5;
			ctx.lineCap = 'round';
			ctx.stroke();
		}
		ctx.lineCap = 'butt';
	}

	// --- Lounge bars: outward-only, smooth wave around the full ring ---
	const spacing = low ? barSpacing + 3 : mid ? barSpacing + 1 : barSpacing;
	const barNum = Math.floor((radius * 2 * Math.PI) / (barWidth + spacing));
	if (barNum <= 0) return;

	const bins = frequencyData.length;
	const live = e >= 0.75;

	if (!ringDisplay || ringDisplay.length !== barNum) {
		ringDisplay = new Float32Array(barNum);
		ringScratchA = new Float32Array(barNum);
		ringScratchB = new Float32Array(barNum);
	}

	const display = ringDisplay;
	const a = ringScratchA!;
	const b = ringScratchB!;

	if (live && bins > 2) {
		// Mirrored, log-spaced sampling — symmetric ring (see ringBinFor).
		for (let i = 0; i < barNum; i++) {
			const raw = (frequencyData[ringBinFor(i, barNum, bins)] ?? 0) / 255;
			a[i] = Math.pow(raw, 0.6);
		}

		// Circular spatial blur — continuous wave instead of FFT spikes
		const passes = low ? 2 : 3;
		let src = a;
		let dst = b;
		for (let pass = 0; pass < passes; pass++) {
			for (let i = 0; i < barNum; i++) {
				const p2 = src[(i - 2 + barNum) % barNum];
				const p1 = src[(i - 1 + barNum) % barNum];
				const c = src[i];
				const n1 = src[(i + 1) % barNum];
				const n2 = src[(i + 2) % barNum];
				dst[i] = p2 * 0.1 + p1 * 0.2 + c * 0.4 + n1 * 0.2 + n2 * 0.1;
			}
			const tmp = src;
			src = dst;
			dst = tmp;
		}

		// Temporal smooth — attack faster than release so speech pops, then rolls off
		for (let i = 0; i < barNum; i++) {
			const target = src[i];
			const prev = display[i];
			const k = target > prev ? 0.55 : 0.2;
			display[i] = prev + (target - prev) * k;
		}
	} else {
		for (let i = 0; i < barNum; i++) {
			display[i] *= 0.85; // soft retract to points
			if (display[i] < 0.01) display[i] = 0;
		}
	}

	ctx.fillStyle = isError ? '#ffb4aa' : barColor;
	ctx.shadowBlur = low ? 0 : mid ? Math.min(12, shadowBlur * 0.35) : shadowBlur + e * 28;
	ctx.shadowColor = isError ? 'rgba(240, 110, 100, 0.8)' : shadowColor;

	const maxExt = radius * 0.55;
	const drive = 1.15 + e * 0.85;

	for (let i = 0; i < barNum; i++) {
		const ext = Math.min(maxExt, display[i] * maxExt * drive);
		// Resting ticks on the ring; live bars grow only outward (+y after rotate)
		const h = barHeight + ext;
		const alfa = (i * 2 * Math.PI) / barNum;

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(alfa);
		ctx.fillRect(0, radius, barWidth, h);
		ctx.restore();
	}

	ctx.shadowBlur = 0;
}
