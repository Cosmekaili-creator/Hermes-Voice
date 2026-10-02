/**
 * Action approvals — a human confirmation step before Hermes does anything with a
 * real-world effect (send, book, buy, delete, change a calendar...).
 *
 * Two independent triggers, either is enough:
 *  1. the realtime model flags the task (`requires_approval: true` on start_task), and
 *  2. a client-side backstop that recognises side-effect verbs in the brief itself, so a
 *     model that forgets (or is prompt-injected into skipping) the flag still can't
 *     dispatch "send an email to…" without the user seeing it first.
 *
 * Pure module (no Svelte state) so the detection rules are unit-testable.
 */

/**
 * Side-effect verbs (en/fr/es) at a clause start or after a request lead-in ("Send…",
 * "…and add it to…", "could you book…", "I need you to email…", "Envoie…", "Reserva…").
 * Clause-anchored on purpose: "what did Marc send me?" is a lookup, not an action. This is
 * a BACKSTOP to the model's own requires_approval flag, not a complete classifier.
 */
const VERBS = [
	// en
	'send',
	'reply',
	'respond',
	'forward',
	'email',
	'e-mail',
	'text',
	'message',
	'ping',
	'notify',
	'tell',
	'let',
	'remind',
	'write to',
	'post',
	'publish',
	'tweet',
	'share',
	'invite',
	'book',
	'reserve',
	'buy',
	'purchase',
	'order',
	'pay',
	'wire',
	'transfer',
	'donate',
	'refund',
	'delete',
	'remove',
	'erase',
	'cancel',
	'unsubscribe',
	'archive',
	'mark',
	'move',
	'schedule',
	'reschedule',
	'create',
	'add',
	'accept',
	'decline',
	'update',
	'change',
	'edit',
	'rename',
	'set up',
	'sign up',
	'register',
	'submit',
	'grant',
	'revoke',
	'merge',
	'approve',
	'execute',
	'restart',
	'shut down',
	'reboot',
	'deploy',
	'install',
	'uninstall',
	'turn on',
	'turn off',
	'switch on',
	'switch off',
	'unlock',
	'lock',
	// fr
	'envoie',
	'envoyer',
	'réponds',
	'répondre',
	'transfère',
	'écris',
	'écrire',
	'préviens',
	'rappelle',
	'réserve',
	'réserver',
	'achète',
	'acheter',
	'commande',
	'paie',
	'payer',
	'vire',
	'supprime',
	'supprimer',
	'efface',
	'annule',
	'annuler',
	'archive',
	'déplace',
	'ajoute',
	'ajouter',
	'crée',
	'créer',
	'planifie',
	'programme',
	'invite',
	'publie',
	'partage',
	'allume',
	'éteins',
	'déverrouille',
	'redémarre',
	'installe',
	// es
	'envía',
	'envia',
	'enviar',
	'responde',
	'reenvía',
	'escribe',
	'avisa',
	'recuerda',
	'reserva',
	'reservar',
	'compra',
	'comprar',
	'pide',
	'paga',
	'pagar',
	'transfiere',
	'borra',
	'elimina',
	'cancela',
	'archiva',
	'mueve',
	'añade',
	'agrega',
	'crea',
	'programa',
	'agenda',
	'invita',
	'publica',
	'comparte',
	'enciende',
	'apaga',
	'desbloquea',
	'reinicia',
	'instala'
];

const LEAD_INS = [
	'and',
	'then',
	'please',
	'also',
	'could you',
	'can you',
	'would you',
	'will you',
	'i need you to',
	'i want you to',
	"i'd like you to",
	'go ahead and',
	'make sure to',
	'et',
	'puis',
	"s'il te plaît",
	'peux-tu',
	'pourrais-tu',
	'merci de',
	'y',
	'luego',
	'por favor',
	'puedes',
	'podrías'
];

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SIDE_EFFECT_RE = new RegExp(
	`(?:^|[.;:!?\\n]\\s*|(?:^|\\s)(?:${LEAD_INS.map(escapeRe).join('|')})\\s+)(?:${VERBS.map(escapeRe).join('|')})(?=$|[\\s,.;:!?])`,
	'iu'
);

export function looksLikeSideEffect(request: string): boolean {
	return SIDE_EFFECT_RE.test(request.trim());
}

export function needsApproval(request: string, modelFlag: boolean, enabled: boolean): boolean {
	if (!enabled) return false;
	return modelFlag || looksLikeSideEffect(request);
}

export type PendingApproval = {
	id: string;
	callId: string;
	summary: string;
	request: string;
	title?: string;
	createdAt: number;
	/** userTurnSeq when created — a spoken approval needs a later user turn. */
	userTurnAtCreate: number;
	/** Legacy ask_hermes call held open (VOICE_ASYNC_TASKS=0) — approve runs the bridge. */
	legacy?: boolean;
};

/** Short one-line summary for the card header: model-provided, else the brief's first clause. */
export function approvalSummary(request: string, modelSummary?: string): string {
	const fromModel = modelSummary?.trim();
	if (fromModel) return fromModel.length > 140 ? `${fromModel.slice(0, 139)}…` : fromModel;
	const first = request.trim().split(/(?<=[.!?])\s/)[0] ?? request;
	return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

export const APPROVALS_STORAGE_KEY = 'hermes-voice.confirmActions';

export function readApprovalsEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(APPROVALS_STORAGE_KEY) !== '0';
	} catch {
		return true;
	}
}

export function writeApprovalsEnabled(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(APPROVALS_STORAGE_KEY, enabled ? '1' : '0');
	} catch {
		/* ignore */
	}
}
