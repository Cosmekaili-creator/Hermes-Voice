<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { getLocale, t, type Locale } from '$lib/i18n';
	import LocaleSwitch from '$lib/components/LocaleSwitch.svelte';
	import SetupWizard from '$lib/components/SetupWizard.svelte';

	let { data } = $props();

	const locale = $derived((browser ? getLocale() : page.data.locale) as Locale);

	let unlockToken = $state('');
	let unlockError = $state(false);
	let unlocking = $state(false);
	let unlockedLocal = $state(false);
	const unlocked = $derived(data.unlocked || unlockedLocal);

	// Strip ?token= from the address bar after unlock (cosmetic; cookie carries session).
	$effect(() => {
		if (!browser) return;
		if (!unlocked && !data.justUnlocked) return;
		if (!page.url.searchParams.has('token')) return;
		const clean = new URL(page.url);
		clean.searchParams.delete('token');
		replaceState(clean.pathname + clean.search + clean.hash, {});
	});

	async function unlock() {
		unlocking = true;
		unlockError = false;
		try {
			const res = await fetch('/api/setup/unlock', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: unlockToken }),
				credentials: 'same-origin'
			});
			const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
			if (json.ok) {
				unlockedLocal = true;
			} else {
				unlockError = true;
			}
		} catch {
			unlockError = true;
		} finally {
			unlocking = false;
		}
	}
</script>

{#if data.mode === 'ops_locked'}
	<div class="gate">
		<div class="glow" aria-hidden="true"></div>
		<div class="locale-corner"><LocaleSwitch /></div>
		<div class="copy">
			<p class="brand">{t('wizard.brand', locale)}</p>
			<h1>{t('wizard.opsLockedTitle', locale)}</h1>
			<p class="body">{t('wizard.opsLocked', locale)}</p>
		</div>
	</div>
{:else if data.mode === 'complete' && !unlocked}
	<div class="gate">
		<div class="glow" aria-hidden="true"></div>
		<div class="locale-corner"><LocaleSwitch /></div>
		<div class="copy">
			<p class="brand">{t('wizard.brand', locale)}</p>
			<h1>{t('wizard.completeLockedTitle', locale)}</h1>
			<p class="body">{t('wizard.completeLocked', locale)}</p>
			<a class="link" href="/">{t('wizard.openLounge', locale)}</a>
		</div>
	</div>
{:else if data.mode === 'bootstrap' && !unlocked}
	<div class="gate">
		<div class="glow" aria-hidden="true"></div>
		<div class="locale-corner"><LocaleSwitch /></div>
		<div class="copy form">
			<p class="brand">{t('wizard.brand', locale)}</p>
			<h1>{t('wizard.unlockTitle', locale)}</h1>
			<p class="body">{t('wizard.unlockHint', locale)}</p>
			<label class="field">
				<span>{t('wizard.unlockToken', locale)}</span>
				<input type="password" autocomplete="off" bind:value={unlockToken} />
			</label>
			{#if unlockError}
				<p class="fail" role="alert">{t('wizard.unlockFailed', locale)}</p>
			{/if}
			<button
				type="button"
				class="btn"
				disabled={unlocking || !unlockToken.trim()}
				onclick={unlock}
			>
				{t('wizard.unlock', locale)}
			</button>
		</div>
	</div>
{:else}
	<SetupWizard rotation={data.rotation} />
{/if}

<style>
	.gate {
		--ink: #e8f7f8;
		--muted: #8eb8bc;
		--accent: #5ee7ff;

		position: relative;
		isolation: isolate;
		min-height: 100dvh;
		overflow: hidden;
		display: grid;
		place-items: center;
		color: var(--ink);
		font-family: 'DM Sans', system-ui, sans-serif;
		background: radial-gradient(ellipse at 50% 45%, #0d3a40 0%, #061618 42%, #030a0c 100%);
		padding: 1.25rem;
	}

	.glow {
		position: absolute;
		inset: -10%;
		z-index: 0;
		pointer-events: none;
		background:
			radial-gradient(circle at 50% 46%, rgba(94, 231, 255, 0.1), transparent 42%),
			radial-gradient(circle at 30% 70%, rgba(202, 253, 255, 0.04), transparent 35%);
		animation: field-breathe 8s ease-in-out infinite;
		filter: blur(2px);
	}

	@keyframes field-breathe {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.7;
		}
		50% {
			transform: scale(1.05);
			opacity: 0.95;
		}
	}

	.locale-corner {
		position: absolute;
		z-index: 2;
		top: max(0.85rem, env(safe-area-inset-top));
		right: max(0.85rem, env(safe-area-inset-right));
	}

	.copy {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		text-align: center;
		max-width: 28rem;
	}

	.copy.form {
		align-items: stretch;
		text-align: left;
		width: min(24rem, 100%);
	}

	.brand {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.4rem, 4vw, 2rem);
		font-weight: 500;
		letter-spacing: 0.22em;
		line-height: 1;
		text-indent: 0.22em;
		color: rgba(232, 247, 248, 0.45);
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.15rem, 3.5vw, 1.5rem);
		font-weight: 500;
		text-align: center;
	}

	.body {
		margin: 0;
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.field input {
		padding: 0.65rem 0.75rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 0.55rem;
		background: rgba(4, 20, 24, 0.65);
		color: var(--ink);
		font: inherit;
	}

	.btn {
		min-height: 2.4rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(94, 231, 255, 0.45);
		background: rgba(94, 231, 255, 0.16);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.fail {
		margin: 0;
		color: #ff8f8f;
		font-size: 0.9rem;
	}

	.link {
		color: var(--accent);
		text-decoration: none;
		font-size: 0.95rem;
	}

	.link:hover {
		text-decoration: underline;
	}
</style>
