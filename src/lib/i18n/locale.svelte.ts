import { browser } from '$app/environment';
import { catalog } from './catalog';
import {
	LOCALE_STORAGE_KEY,
	localeCookieValue,
	localeFromAcceptLanguage
} from './resolve';
import { isLocale, type Locale, type MessageKey } from './types';

let locale = $state<Locale>('en');

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
			navigator.languages?.length > 0
				? navigator.languages.join(',')
				: navigator.language || null;
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

export function t(key: MessageKey, loc: Locale = locale): string {
	return catalog[loc][key] ?? catalog.en[key] ?? key;
}

export { LOCALE_COOKIE, LOCALE_STORAGE_KEY } from './resolve';
