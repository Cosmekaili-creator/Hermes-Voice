/** Best-effort device haptic — no-op when unsupported. */
export function pulse(pattern: number | number[]): void {
	try {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
		navigator.vibrate(pattern);
	} catch {
		/* ignore */
	}
}
