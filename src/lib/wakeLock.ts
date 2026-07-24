/**
 * Screen Wake Lock while Hermes Voice lounge is open.
 * Pattern mirrored from app.steel.coach ScreenWakeLock (visibility re-acquire).
 */
export function createScreenWakeLock() {
	let sentinel: WakeLockSentinel | null = null;
	let acquireInFlight: Promise<void> | null = null;
	let wanted = false;
	let listenersBound = false;

	async function release() {
		const s = sentinel;
		sentinel = null;
		if (!s || s.released) return;
		try {
			await s.release();
		} catch {
			/* already released by OS */
		}
	}

	async function sync() {
		if (!('wakeLock' in navigator)) return;

		const want = wanted && document.visibilityState === 'visible';

		if (!want) {
			if (acquireInFlight) await acquireInFlight;
			await release();
			return;
		}

		if (sentinel && !sentinel.released) return;

		if (acquireInFlight) {
			await acquireInFlight;
			return sync();
		}

		acquireInFlight = (async () => {
			try {
				const next = await navigator.wakeLock.request('screen');
				if (!(wanted && document.visibilityState === 'visible')) {
					try {
						await next.release();
					} catch {
						/* ignore */
					}
					return;
				}
				sentinel = next;
				next.addEventListener(
					'release',
					() => {
						sentinel = null;
					},
					{ once: true }
				);
			} catch {
				/* NotAllowedError / unsupported — silent */
			}
		})();

		try {
			await acquireInFlight;
		} finally {
			acquireInFlight = null;
		}
	}

	function bindListeners() {
		if (listenersBound) return;
		listenersBound = true;
		document.addEventListener('visibilitychange', () => {
			void sync();
		});
	}

	return {
		/** Keep screen on while the unlocked lounge is mounted. */
		async enable() {
			wanted = true;
			bindListeners();
			await sync();
		},
		async disable() {
			wanted = false;
			await sync();
		}
	};
}
