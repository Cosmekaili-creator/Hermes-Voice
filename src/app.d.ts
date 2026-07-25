// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			locale: import('$lib/i18n').Locale;
			/** Non-secret principal from Lounge cookie/key — never includes voice/Hermes secrets. */
			principal?: {
				id: string;
				role: 'owner' | 'user';
				label: string;
			} | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
