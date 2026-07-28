/**
 * Caption sync debug — batch events to the server when ?cdbg=1 (or localStorage).
 * Private Lounge only; endpoint requires voice session cookie.
 */

export type CaptionDebugEvent = {
	t: number;
	type: string;
	[key: string]: unknown;
};

const STORAGE_KEY = 'hermes-voice.captionDebug';
const FLUSH_MS = 400;
const MAX_QUEUE = 200;

function debugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		if (new URLSearchParams(window.location.search).get('cdbg') === '1') return true;
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

export function isCaptionDebugEnabled(): boolean {
	return debugEnabled();
}

export function createCaptionDebugger() {
	const enabled = debugEnabled();
	const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
	let queue: CaptionDebugEvent[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	const session = `cap-${Date.now().toString(36)}`;

	function nowMs() {
		return Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
	}

	async function flush() {
		if (!enabled || queue.length === 0) return;
		const batch = queue;
		queue = [];
		try {
			await fetch('/api/debug/captions', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ session, events: batch })
			});
		} catch {
			/* ignore — debug must not break voice */
		}
	}

	function scheduleFlush() {
		if (!enabled || flushTimer !== null) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void flush();
		}, FLUSH_MS);
	}

	return {
		get enabled() {
			return enabled;
		},
		log(type: string, data: Record<string, unknown> = {}) {
			if (!enabled) return;
			queue.push({ t: nowMs(), type, ...data });
			if (queue.length >= MAX_QUEUE) {
				if (flushTimer !== null) {
					clearTimeout(flushTimer);
					flushTimer = null;
				}
				void flush();
				return;
			}
			scheduleFlush();
		},
		async flush() {
			if (flushTimer !== null) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			await flush();
		},
		destroy() {
			if (flushTimer !== null) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			void flush();
		}
	};
}
