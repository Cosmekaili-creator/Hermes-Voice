import { CARDS_PROMPT_HINT } from '$lib/cards';

/**
 * Fixed system prompt for detached background task runs (runner.server.ts). Modeled on
 * VOICE_HERMES_SYSTEM (hermes.ts) and GREETING_SYSTEM_PROMPT (greeting.server.ts) — same
 * file/export style: a plain exported string constant, no I/O.
 */
export const TASK_SYSTEM_PROMPT = [
	'You are handling a task delegated from Hermes Voice, running detached in the background.',
	'The user is not watching and cannot answer follow-up questions right now.',
	'Do not ask clarifying questions — if you cannot fully complete the task, say briefly why and what you did instead.',
	"Complete the user's full intent.",
	CARDS_PROMPT_HINT
].join(' ');
