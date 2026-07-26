export { en } from './en';
export { fr } from './fr';
export { es } from './es';
export { catalog } from './catalog';
export {
	getLocale,
	setLocale,
	t,
	resolveInitial,
	initLocale,
	syncLocale,
	LOCALE_COOKIE,
	LOCALE_STORAGE_KEY
} from './locale.svelte.js';
export { resolveRequestLocale, localeFromAcceptLanguage } from './resolve.js';
export {
	LOCALES,
	isLocale,
	type Locale,
	type MessageKey,
	type Messages,
	type VoiceErrorCode
} from './types';
