import { browser } from '$app/environment';
import { DEFAULT_ASSISTANT_NAME } from '$lib/persona/types';
import { catalog } from './catalog';
import { LOCALE_STORAGE_KEY, localeCookieValue, localeFromAcceptLanguage } from './resolve';
import { isLocale, type Locale, type MessageKey } from './types';

let locale = $state<Locale>('en');
/**
 * Ambient fallback assistant name for `t()` calls that don't pass an explicit override.
 * Module-level `$state` is process-global across SSR requests on this long-lived
 * adapter-node process — mutating it on the server would leak one user's persona
 * name/address into another user's SSR render. Browser-only by design; mirrors
 * `syncLocale()`'s guard, not `setLocale()`'s (which lacks it for a different, already
 * understood reason).
 */
let assistantName = $state<string>(DEFAULT_ASSISTANT_NAME);

function readStoredLocale(): Locale | null {
	if (!browser) return null;
	try {
		const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
		return isLocale(stored) ? stored : null;
	} catch {
		return null;
	}
}

function writeStoredLocale(next: Locale): void {
	if (!browser) return;
	try {
		localStorage.setItem(LOCALE_STORAGE_KEY, next);
	} catch {
		/* ignore */
	}
	try {
		const secure = typeof location !== 'undefined' && location.protocol === 'https:';
		document.cookie = localeCookieValue(next, secure);
	} catch {
		/* ignore */
	}
}

export function getLocale(): Locale {
	return locale;
}

/** Browser-only detect (storage → navigator → en). */
export function resolveInitial(): Locale {
	const stored = readStoredLocale();
	if (stored) return stored;

	if (typeof navigator !== 'undefined') {
		const header =
			navigator.languages?.length > 0 ? navigator.languages.join(',') : navigator.language || null;
		return localeFromAcceptLanguage(header) ?? 'en';
	}

	return 'en';
}

/**
 * Browser-only: align module locale with SSR locale, preferring localStorage.
 * No-op on the server (avoids cross-request module state).
 */
export function syncLocale(serverLocale: Locale): void {
	if (!browser) return;
	const stored = readStoredLocale();
	const next = stored ?? (isLocale(serverLocale) ? serverLocale : resolveInitial());
	locale = next;
	document.documentElement.lang = next;
	if (stored && stored !== serverLocale) {
		writeStoredLocale(stored);
	}
}

export function initLocale(): void {
	if (!browser) return;
	const resolved = resolveInitial();
	locale = resolved;
	document.documentElement.lang = resolved;
}

export function setLocale(next: Locale): void {
	if (!isLocale(next)) return;
	locale = next;
	writeStoredLocale(next);
	if (browser) {
		document.documentElement.lang = next;
	}
}

/** Browser-only setter, mirroring syncLocale()'s SSR-safety guard exactly — see comment above. */
export function setAssistantName(next: string): void {
	if (!browser) return;
	assistantName = next;
}

/** SSR always sees DEFAULT_ASSISTANT_NAME — callers that need a bound persona's name during
 * SSR must pass it explicitly as t()'s third argument (see LazicLounge.svelte / +layout.svelte). */
export function getAssistantName(): string {
	return browser ? assistantName : DEFAULT_ASSISTANT_NAME;
}

export function t(
	key: MessageKey,
	loc: Locale = locale,
	assistant: string = getAssistantName()
): string {
	const raw = catalog[loc][key] ?? catalog.en[key] ?? key;
	return raw.replaceAll('{assistant}', assistant);
}

export { LOCALE_COOKIE, LOCALE_STORAGE_KEY } from './resolve';
