/** One-time-per-browser mic priming flag (mirrors hermes-voice.talkMode / .locale). */
export const MIC_PRIMED_STORAGE_KEY = 'hermes-voice.micPrimed';

export function hasMicPrimed(): boolean {
	if (typeof localStorage === 'undefined') return true; // SSR: never prime
	try {
		return localStorage.getItem(MIC_PRIMED_STORAGE_KEY) === '1';
	} catch {
		return true;
	}
}

export function markMicPrimed(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(MIC_PRIMED_STORAGE_KEY, '1');
	} catch {
		/* ignore */
	}
}

/**
 * True when we should show the priming notice: not shown before AND the browser
 * has not already granted the mic. Permissions API is optional (Firefox/Safari
 * may throw on name 'microphone') — on any failure we still prime.
 */
export async function shouldPrimeMic(): Promise<boolean> {
	if (hasMicPrimed()) return false;
	try {
		const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
		const status = await perms?.query({ name: 'microphone' as PermissionName });
		if (status?.state === 'granted') {
			markMicPrimed();
			return false;
		}
	} catch {
		/* unsupported — prime anyway */
	}
	return true;
}
