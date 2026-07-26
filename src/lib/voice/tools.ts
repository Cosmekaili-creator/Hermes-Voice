/** Client tool registered on provider session.update — browser executes via POST /api/hermes. */
export const ASK_HERMES_TOOL = {
	type: 'function',
	name: 'ask_hermes',
	description:
		'Delegate email, calendar, contacts, VPS, memory lookups, or any tool-backed work to Hermes Agent. Use for actions you cannot perform in voice alone.',
	parameters: {
		type: 'object',
		properties: {
			request: {
				type: 'string',
				description:
					'Complete natural-language brief for Hermes. Include every proper noun, place, date/time, and the intended action (e.g. search + add to calendar). Do not omit venue names or cities.'
			}
		},
		required: ['request']
	}
} as const;

export const VOICE_TOOLS = [ASK_HERMES_TOOL];
