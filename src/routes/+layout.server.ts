import { DEFAULT_PERSONA } from '$lib/persona/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	locale: locals.locale,
	// Unauthenticated visitors (locked gate) get DEFAULT_PERSONA — never leaks a bound
	// persona's name before the voice key gate is passed.
	persona: locals.principal?.persona ?? DEFAULT_PERSONA
});
