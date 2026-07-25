import type { en } from './en';

export type Locale = 'en' | 'fr' | 'es';

export type MessageKey = keyof typeof en;

export type Messages = Record<MessageKey, string>;

export type VoiceErrorCode = Extract<MessageKey, `error.${string}`>;

export const LOCALES: readonly Locale[] = ['en', 'fr', 'es'] as const;

export function isLocale(value: unknown): value is Locale {
	return value === 'en' || value === 'fr' || value === 'es';
}
