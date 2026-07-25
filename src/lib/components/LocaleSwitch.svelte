<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getLocale, setLocale, t, LOCALES, type Locale } from '$lib/i18n';

	const labels: Record<Locale, string> = {
		en: 'EN',
		fr: 'FR',
		es: 'ES'
	};

	const current = $derived((browser ? getLocale() : page.data.locale) as Locale);
	const groupLabel = $derived(t('meta.language', current));
</script>

<div class="locale" role="group" aria-label={groupLabel}>
	{#each LOCALES as loc (loc)}
		<button
			type="button"
			class="locale__btn"
			class:locale__btn--active={current === loc}
			aria-pressed={current === loc}
			onclick={() => setLocale(loc)}
		>
			{labels[loc]}
		</button>
	{/each}
</div>

<style>
	.locale {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
	}

	.locale__btn {
		min-width: 2rem;
		min-height: 1.7rem;
		padding: 0.2rem 0.45rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: #8eb8bc;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}

	.locale__btn:hover {
		color: #e8f7f8;
	}

	.locale__btn:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 1px;
	}

	.locale__btn--active {
		background: rgba(94, 231, 255, 0.16);
		color: #e8f7f8;
	}
</style>
