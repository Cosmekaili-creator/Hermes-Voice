import { isLocale, type Locale } from './types';

/** Readable cookie for SSR `<html lang>` + first paint (not HttpOnly). */
export const LOCALE_COOKIE = 'hv_locale';

/** Client override; wins over cookie/navigator when present. */
export const LOCALE_STORAGE_KEY = 'hermes-voice.locale';

export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
	if (!header) return null;
	const tags = header.split(',').map((part) => {
		const [tag, ...params] = part.trim().split(';');
		let q = 1;
		for (const p of params) {
			const m = p.trim().match(/^q=([0-9.]+)$/i);
			if (m) q = Number(m[1]) || 0;
		}
		return { tag: tag.toLowerCase(), q };
	});
	tags.sort((a, b) => b.q - a.q);
	for (const { tag } of tags) {
		const primary = tag.split('-')[0];
		if (isLocale(primary)) return primary;
	}
	return null;
}

export function resolveRequestLocale(
	cookieValue: string | undefined,
	acceptLanguage: string | null | undefined
): Locale {
	if (isLocale(cookieValue)) return cookieValue;
	return localeFromAcceptLanguage(acceptLanguage) ?? 'en';
}

export function localeCookieValue(locale: Locale, secure: boolean): string {
	const parts = [`${LOCALE_COOKIE}=${locale}`, 'Path=/', 'Max-Age=31536000', 'SameSite=Lax'];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}
