export type SettingsSecretHint = { fieldSet: boolean; fieldHint: string };

export type SettingsCurrent = {
	ok: true;
	provider: 'xai' | 'openai';
	voiceId: string | null;
	hermesApiBase: string;
	multiUser: boolean;
	xaiApiKey: SettingsSecretHint;
	openaiApiKey: SettingsSecretHint;
	hermesApiKey: SettingsSecretHint;
	hermesSessionKey: SettingsSecretHint;
	/** Non-secret — gates the modal's "Restart service" action (chunk D3/D5). */
	selfRestartEnabled: boolean;
};

const EMPTY_HINT: SettingsSecretHint = { fieldSet: false, fieldHint: '' };

/**
 * Settings modal form state (chunk A). MUST be a class with `$state` fields in a
 * `.svelte.ts` module — NOT an object literal built from local `$state` variables,
 * which would capture values at construction and break `bind:value` write-back.
 *
 * Every field defaults empty (not the wizard's non-empty defaults, e.g.
 * `hermesApiBase: 'http://127.0.0.1:8642'` / `hermesSessionKey: 'agent:main:voice'`).
 * Only `dirtyFields()` output is ever sent to the server — this is a second,
 * independent safety layer on top of the server-side present-key contract in
 * `src/routes/api/settings/save/+server.ts`: corrupting config via this path would
 * require both a client dirty-tracking bug AND a server present-key bug at once.
 */
export class SettingsForm {
	voiceProvider = $state<'xai' | 'openai'>('xai');
	xaiApiKey = $state(''); // blank = "keep current", never sent unless dirty
	openaiApiKey = $state('');
	voiceId = $state<string | null>(null);
	hermesApiBase = $state(''); // empty default — NOT the wizard's 'http://127.0.0.1:8642'
	hermesApiKey = $state('');
	hermesSessionKey = $state(''); // empty default — NOT the wizard's 'agent:main:voice'

	busy = $state(false);
	testStatus = $state<'idle' | 'ok' | 'fail'>('idle');
	testCode = $state<string | null>(null);
	saveError = $state<string | null>(null);
	saved = $state(false);

	multiUser = $state(false);
	selfRestartEnabled = $state(false);
	xaiApiKeyHint = $state<SettingsSecretHint>(EMPTY_HINT);
	openaiApiKeyHint = $state<SettingsSecretHint>(EMPTY_HINT);
	hermesApiKeyHint = $state<SettingsSecretHint>(EMPTY_HINT);
	hermesSessionKeyHint = $state<SettingsSecretHint>(EMPTY_HINT);

	#initial: { voiceProvider: 'xai' | 'openai'; voiceId: string | null; hermesApiBase: string } = {
		voiceProvider: 'xai',
		voiceId: null,
		hermesApiBase: ''
	};

	/**
	 * Prefill from `GET /api/settings/current`. Secret fields always render blank
	 * (never hydrated with the real value, even owner-only) — the UI shows a
	 * "leave blank to keep (ends in •••XXXX)" placeholder built from the returned hint.
	 */
	hydrate(current: SettingsCurrent): void {
		this.voiceProvider = current.provider;
		this.voiceId = current.voiceId;
		this.hermesApiBase = current.hermesApiBase;
		this.multiUser = current.multiUser;
		this.selfRestartEnabled = current.selfRestartEnabled;

		this.xaiApiKey = '';
		this.openaiApiKey = '';
		this.hermesApiKey = '';
		this.hermesSessionKey = '';

		this.xaiApiKeyHint = current.xaiApiKey;
		this.openaiApiKeyHint = current.openaiApiKey;
		this.hermesApiKeyHint = current.hermesApiKey;
		this.hermesSessionKeyHint = current.hermesSessionKey;

		this.#initial = {
			voiceProvider: current.provider,
			voiceId: current.voiceId,
			hermesApiBase: current.hermesApiBase
		};

		this.busy = false;
		this.testStatus = 'idle';
		this.testCode = null;
		this.saveError = null;
		this.saved = false;
	}

	/**
	 * Only dirty, section-scoped fields are ever sent to the server, keyed by the exact
	 * managed-env-key names `/api/settings/save` expects (see `SECTION_ALLOWLIST` there).
	 *
	 * Dirty ⇔ a non-empty typed value, for SECRET fields (xaiApiKey / openaiApiKey /
	 * hermesApiKey / hermesSessionKey) — never a diff against a hint string, since a
	 * secret field is never hydrated with its real value (see `hydrate()`). This also
	 * means a secret field can only ever be sent if the user actively typed into it,
	 * eliminating any stale-prefill race as a source of unwanted writes.
	 * Dirty ⇔ differs from the hydrated snapshot, for NON-SECRET fields (provider,
	 * hermesApiBase, voiceId).
	 */
	dirtyFields(section: 'provider' | 'hermes'): Record<string, string> {
		const fields: Record<string, string> = {};

		if (section === 'provider') {
			if (this.voiceProvider !== this.#initial.voiceProvider) {
				fields.VOICE_PROVIDER = this.voiceProvider;
			}
			if (this.xaiApiKey.trim()) fields.XAI_API_KEY = this.xaiApiKey.trim();
			if (this.openaiApiKey.trim()) fields.OPENAI_API_KEY = this.openaiApiKey.trim();
			if (this.voiceId !== this.#initial.voiceId && this.voiceId) {
				// "Provider default" (voiceId → null) has no wire representation here —
				// /api/settings/save rejects empty-string writes outright (A5 item 4), so
				// clearing an env-level voice override is out of scope for this route by
				// design (clearing a managed key stays a /setup or hand-edit action).
				const envKey = this.voiceProvider === 'openai' ? 'OPENAI_VOICE' : 'XAI_VOICE';
				fields[envKey] = this.voiceId;
			}
			return fields;
		}

		if (this.hermesApiBase !== this.#initial.hermesApiBase) {
			fields.HERMES_API_BASE = this.hermesApiBase;
		}
		if (this.hermesApiKey.trim()) fields.HERMES_API_KEY = this.hermesApiKey.trim();
		if (this.hermesSessionKey.trim()) fields.HERMES_SESSION_KEY = this.hermesSessionKey.trim();
		return fields;
	}
}
