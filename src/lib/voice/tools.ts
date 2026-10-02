/** Client tools registered on provider session.update — browser executes via POST /api/hermes
 * (legacy ask_hermes) or POST /api/tasks/dispatch|clear (start_task/clear_task_queue). */

/** Legacy blocking bridge tool — kept for the VOICE_ASYNC_TASKS kill-switch path (Part F).
 * Not registered when async tasks are enabled (the default). */
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

export const START_TASK_TOOL = {
	type: 'function',
	name: 'start_task',
	description:
		'Hand work to Hermes Agent. Use it for exactly three things: live or current information you cannot ' +
		'know (weather, news, prices, schedules, availability); anything about the user personally (mail, ' +
		'calendar, contacts, files, notes, machines, past conversations); and actions with a real effect ' +
		'(sending, booking, buying, changing a system). Do NOT use it for general knowledge, explanations, ' +
		'history, science or opinions — answer those yourself. When not set, background defaults to false: ' +
		'quick things may come back as the result of this call; slower ones run in the background and reach ' +
		'you later. Either way, never tell the user you are searching or that you will report back. You can ' +
		'start several tasks in one turn.',
	parameters: {
		type: 'object',
		properties: {
			request: {
				type: 'string',
				description:
					'Complete natural-language brief for Hermes. Include every proper noun, place, date/time, and the intended action. Hermes cannot ask you follow-up questions — the brief must stand alone.'
			},
			title: {
				type: 'string',
				description:
					'Very short label for this task (2-5 words) used if reporting results back to the user later.'
			},
			background: {
				type: 'boolean',
				description:
					'True when you have already answered the user from your own knowledge and this task only enriches ' +
					'that answer later. Skips the short inline wait so the conversation never stalls. Leave it out ' +
					'when the user is waiting on this task for their answer.'
			},
			requires_approval: {
				type: 'boolean',
				description:
					'True for anything with a real-world effect (sending, replying, booking, buying, paying, deleting, ' +
					'creating or moving calendar entries, changing settings or systems). The user must approve on ' +
					'screen or out loud before it runs.'
			},
			approval_summary: {
				type: 'string',
				description:
					'With requires_approval: one short line saying exactly what will happen, e.g. "Send Marc an email ' +
					'moving today\'s call to Thursday".'
			}
		},
		required: ['request']
	}
} as const;

export const CLEAR_TASK_QUEUE_TOOL = {
	type: 'function',
	name: 'clear_task_queue',
	description:
		'Discard pending completed-task results without reading them out, when the user says to clear/skip them. Does not cancel work still in progress.',
	parameters: { type: 'object', properties: {}, required: [] }
} as const;

export const RESOLVE_APPROVAL_TOOL = {
	type: 'function',
	name: 'resolve_approval',
	description:
		"Record the user's spoken answer to the action currently waiting for approval (shown on screen). " +
		'Call it only when the user clearly says yes or no to that pending action.',
	parameters: {
		type: 'object',
		properties: {
			approved: {
				type: 'boolean',
				description: 'True if the user approved the pending action, false if they declined.'
			}
		},
		required: ['approved']
	}
} as const;

/** Async-tasks-off (kill switch, Part F): only the legacy blocking tool is registered. */
const LEGACY_TOOLS = [ASK_HERMES_TOOL];
/** Async-tasks-on (default): dispatch + clear, no ask_hermes. */
const ASYNC_TOOLS = [START_TASK_TOOL, CLEAR_TASK_QUEUE_TOOL, RESOLVE_APPROVAL_TOOL];

/** Which tools get sent in `session.update.tools`, gated on the VOICE_ASYNC_TASKS flag
 * threaded through from the server (see active.server.ts's getAsyncTasksEnabled() /
 * +page.server.ts). Threading a function (rather than a static array) through the provider
 * clients is what lets this flag reach session.update without a page reload. */
export function resolveVoiceTools(asyncEnabled: boolean) {
	return asyncEnabled ? ASYNC_TOOLS : LEGACY_TOOLS;
}

/** @deprecated Prefer `resolveVoiceTools(asyncEnabled)` — this is the async-on (default) set. */
export const VOICE_TOOLS = ASYNC_TOOLS;
