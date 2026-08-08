<script lang="ts">
	import { resolve } from '$app/paths';
	import { getLocale, t } from '$lib/i18n';
	import HermesFields from './HermesFields.svelte';
	import ProviderFields from './ProviderFields.svelte';
	import { SettingsForm, type SettingsCurrent } from './settingsForm.svelte';

	type Section = 'provider' | 'hermes';

	let {
		open,
		section,
		isOwner,
		onClose,
		onReconnect
	}: {
		open: boolean;
		section: Section;
		isOwner: boolean;
		onClose: () => void;
		onReconnect?: () => void;
	} = $props();

	let dialogEl: HTMLDialogElement | undefined = $state();
	const form = new SettingsForm();

	let loadState = $state<'idle' | 'loading' | 'unavailable' | 'ready' | 'error'>('idle');

	// D5: owner-triggered self-restart. A manually-triggered escape hatch reachable from
	// this modal's owner area — chunk A5's save route never returns `restartRequired:
	// true`, so there is no *automatic* prompt from a settings save; only /setup's
	// ORIGIN change (D2) can trigger that (unchanged wizard flow, not this modal).
	type RestartPhase = 'idle' | 'confirm' | 'stopping' | 'waiting' | 'online' | 'timeout' | 'error';
	let restartPhase = $state<RestartPhase>('idle');
	let restartErrorCode = $state<string | null>(null);
	// Bumped on every new attempt so a stale poll from a previous attempt (or one still
	// running after the modal was reopened) can never clobber a newer one's state.
	let restartGeneration = 0;

	// 30s max SHUTDOWN_TIMEOUT + 5s RestartSec + boot time + margin (see deploy/hermes-voice.service).
	const RESTART_POLL_WINDOW_MS = 75_000;
	const RESTART_POLL_INTERVAL_MS = 1000;

	function errorMessage(code: string): string {
		for (const prefix of ['settings.error.', 'wizard.error.', 'users.error.']) {
			const key = `${prefix}${code}` as Parameters<typeof t>[0];
			const msg = t(key, getLocale());
			if (msg !== key) return msg;
		}
		return t('settings.error.generic', getLocale());
	}

	async function loadSettings() {
		loadState = 'loading';
		try {
			const statusRes = await fetch('/api/setup/status', { credentials: 'same-origin' });
			const status = (await statusRes.json().catch(() => null)) as null | {
				mode?: string;
				unlocked?: boolean;
			};
			// mode !== 'complete' (bootstrap/ops_locked) or !unlocked → every /api/setup/* and
			// /api/settings/* route would 403 anyway; show a read-only explanation instead of
			// a confusing all-403 modal rather than let the fetches below fail silently.
			if (!status || status.mode !== 'complete' || !status.unlocked) {
				loadState = 'unavailable';
				return;
			}

			const currentRes = await fetch('/api/settings/current', { credentials: 'same-origin' });
			if (!currentRes.ok) {
				loadState = currentRes.status === 403 ? 'unavailable' : 'error';
				return;
			}
			const current = (await currentRes.json().catch(() => null)) as SettingsCurrent | null;
			if (!current || current.ok !== true) {
				loadState = 'error';
				return;
			}
			form.hydrate(current);
			loadState = 'ready';
		} catch {
			loadState = 'error';
		}
	}

	$effect(() => {
		if (!open) return;
		void loadSettings();
	});

	$effect(() => {
		const dialog = dialogEl;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	/** Fires on Esc, the close button (dialog.close()), and backdrop dismissal alike. */
	function handleDialogClose() {
		onClose();
	}

	function openRestartConfirm() {
		restartPhase = 'confirm';
		restartErrorCode = null;
	}

	function cancelRestart() {
		restartGeneration += 1; // abandon any in-flight poll from a prior attempt
		restartPhase = 'idle';
		restartErrorCode = null;
	}

	async function pollForRestart(myGeneration: number) {
		const deadline = Date.now() + RESTART_POLL_WINDOW_MS;
		let consecutiveOk = 0;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, RESTART_POLL_INTERVAL_MS));
			if (myGeneration !== restartGeneration) return;
			try {
				// A single success can be the dying process's last gasp before it actually
				// stops accepting — require two consecutive successes.
				const res = await fetch('/health', { cache: 'no-store' });
				consecutiveOk = res.ok ? consecutiveOk + 1 : 0;
			} catch {
				consecutiveOk = 0;
			}
			if (myGeneration !== restartGeneration) return;
			if (consecutiveOk >= 2) {
				restartPhase = 'online';
				return;
			}
		}
		if (myGeneration === restartGeneration) restartPhase = 'timeout';
	}

	async function confirmRestart() {
		const myGeneration = ++restartGeneration;
		restartPhase = 'stopping';
		restartErrorCode = null;
		try {
			const res = await fetch('/api/setup/restart', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: '{}'
			});
			const data = (await res.json().catch(() => null)) as null | { ok?: boolean; code?: string };
			if (myGeneration !== restartGeneration) return;
			if (!data?.ok) {
				restartPhase = 'error';
				restartErrorCode = data?.code || 'restart_failed';
				return;
			}
		} catch {
			if (myGeneration !== restartGeneration) return;
			restartPhase = 'error';
			restartErrorCode = 'restart_failed';
			return;
		}

		restartPhase = 'waiting';
		// /api/hermes uses SSE streaming — a restart triggered mid-tool-call can
		// legitimately take up to SHUTDOWN_TIMEOUT before the force-close kicks in, hence
		// the full 75s poll window rather than a near-instant confirmation.
		await pollForRestart(myGeneration);
	}

	async function save() {
		const fields = form.dirtyFields(section);
		form.busy = true;
		form.saveError = null;
		form.saved = false;
		try {
			const res = await fetch('/api/settings/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ section, fields })
			});
			const data = (await res.json().catch(() => null)) as null | {
				ok?: boolean;
				code?: string;
				restartRequired?: boolean;
			};
			if (!data?.ok) {
				form.saveError = errorMessage(data?.code || 'generic');
				return;
			}

			// Refresh hints/prefill (e.g. a fresh "ends in ••••1234" hint after a key
			// rotation) without losing the just-set success state — hydrate() itself
			// resets `saved`, so re-assert it after.
			const currentRes = await fetch('/api/settings/current', { credentials: 'same-origin' });
			const current = (await currentRes.json().catch(() => null)) as SettingsCurrent | null;
			if (current?.ok === true) form.hydrate(current);
			form.saved = true;
		} catch {
			form.saveError = t('settings.error.generic', getLocale());
		} finally {
			form.busy = false;
		}
	}
</script>

<dialog bind:this={dialogEl} class="settings-modal" onclose={handleDialogClose}>
	<div class="modal-head">
		<h2>
			{section === 'provider'
				? t('settings.sectionProvider', getLocale())
				: t('settings.sectionHermes', getLocale())}
		</h2>
		<button
			type="button"
			class="close"
			aria-label={t('settings.close', getLocale())}
			onclick={() => dialogEl?.close()}
		>
			×
		</button>
	</div>

	{#if loadState === 'idle' || loadState === 'loading'}
		<p class="body">{t('health.checking', getLocale())}</p>
	{:else if loadState === 'unavailable'}
		<p class="body">{t('settings.unavailableTitle', getLocale())}</p>
		<p class="body">{t('settings.unavailableBody', getLocale())}</p>
	{:else if loadState === 'error'}
		<p class="err" role="alert">{t('settings.error.generic', getLocale())}</p>
	{:else if loadState === 'ready'}
		{#if section === 'provider'}
			<ProviderFields {form} {onReconnect} />
		{:else}
			<HermesFields {form} />
		{/if}

		{#if form.saveError}
			<p class="err" role="alert">{form.saveError}</p>
		{/if}
		{#if form.saved}
			<p class="ok">{t('settings.saved', getLocale())}</p>
		{/if}

		<div class="row-actions">
			<button type="button" class="btn" disabled={form.busy} onclick={save}>
				{form.busy ? t('settings.saving', getLocale()) : t('settings.save', getLocale())}
			</button>
		</div>

		{#if isOwner}
			<div class="nav">
				<a class="link" href={resolve('/owner/users')}>{t('users.title', getLocale())}</a>
				<a class="link" href={resolve('/owner/health')}>{t('health.title', getLocale())}</a>
			</div>
		{/if}

		{#if isOwner && form.selfRestartEnabled}
			<!-- Hidden entirely (not just disabled) when the server says ALLOW_SELF_RESTART
			     isn't set — offering a button that would only ever 501 is worse than no
			     button at all. Mirrors D2's "only offer restart when it would actually work". -->
			<div class="restart-section">
				{#if restartPhase === 'idle'}
					<button type="button" class="btn ghost danger" onclick={openRestartConfirm}>
						{t('settings.saveRestart', getLocale())}
					</button>
					<p class="field-hint">{t('settings.restartWarning', getLocale())}</p>
				{:else if restartPhase === 'confirm'}
					<p class="body">{t('settings.restartConfirm', getLocale())}</p>
					<p class="field-hint">{t('settings.restartWarning', getLocale())}</p>
					<div class="row-actions">
						<button type="button" class="btn danger" onclick={confirmRestart}>
							{t('settings.saveRestart', getLocale())}
						</button>
						<button type="button" class="btn ghost" onclick={cancelRestart}>
							{t('wizard.back', getLocale())}
						</button>
					</div>
				{:else if restartPhase === 'stopping'}
					<p class="body" aria-live="polite">{t('settings.restartStopping', getLocale())}</p>
				{:else if restartPhase === 'waiting'}
					<p class="body" aria-live="polite">{t('settings.restartWaiting', getLocale())}</p>
				{:else if restartPhase === 'online'}
					<p class="ok" aria-live="polite">{t('settings.restartOk', getLocale())}</p>
					<button type="button" class="btn ghost" onclick={cancelRestart}>
						{t('settings.close', getLocale())}
					</button>
				{:else if restartPhase === 'timeout'}
					<p class="err" role="alert">{t('settings.restartTimeout', getLocale())}</p>
					<button type="button" class="btn ghost" onclick={cancelRestart}>
						{t('settings.close', getLocale())}
					</button>
				{:else if restartPhase === 'error'}
					<p class="err" role="alert">{errorMessage(restartErrorCode || 'restart_failed')}</p>
					<button type="button" class="btn ghost" onclick={cancelRestart}>
						{t('wizard.back', getLocale())}
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</dialog>

<style>
	.settings-modal {
		width: min(28rem, calc(100vw - 2.5rem));
		padding: 1.25rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 0.9rem;
		background: #04151a;
		color: #e8f7f8;
		font-family: 'DM Sans', system-ui, sans-serif;
	}

	.settings-modal::backdrop {
		background: rgba(2, 8, 10, 0.65);
		backdrop-filter: blur(2px);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.9rem;
	}

	.modal-head h2 {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.15rem;
		font-weight: 500;
	}

	.close {
		min-width: 2rem;
		min-height: 2rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}

	.close:hover {
		background: rgba(202, 253, 255, 0.1);
	}

	.body {
		margin: 0 0 0.5rem;
		color: #8eb8bc;
		line-height: 1.4;
	}

	.err {
		margin: 0.5rem 0 0;
		color: #ff8f8f;
	}

	.ok {
		margin: 0.5rem 0 0;
		color: #7dffb2;
	}

	.row-actions {
		margin-top: 0.9rem;
	}

	.btn {
		min-height: 2.3rem;
		padding: 0.4rem 0.9rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(94, 231, 255, 0.45);
		background: rgba(94, 231, 255, 0.16);
		color: #e8f7f8;
		font: inherit;
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.nav {
		display: flex;
		gap: 1rem;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid rgba(202, 253, 255, 0.12);
	}

	.link {
		color: #5ee7ff;
		text-decoration: none;
		font-size: 0.88rem;
	}

	.restart-section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid rgba(202, 253, 255, 0.12);
	}

	.field-hint {
		margin: 0;
		max-width: 24rem;
		font-size: 0.78rem;
		color: #8eb8bc;
		line-height: 1.4;
	}

	.btn.ghost {
		background: transparent;
	}

	.btn.danger {
		border-color: rgba(255, 143, 143, 0.45);
		background: rgba(255, 143, 143, 0.08);
		color: #ffb4b4;
	}
</style>
