import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import type { Locale, Messages } from './types';

export const catalog: Record<Locale, Messages> = {
	en,
	fr,
	es
};
