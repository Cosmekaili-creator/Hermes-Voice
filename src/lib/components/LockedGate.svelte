<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getLocale, t, type Locale } from '$lib/i18n';
	import LocaleSwitch from './LocaleSwitch.svelte';

	const locale = $derived((browser ? getLocale() : page.data.locale) as Locale);
</script>

<div class="gate">
	<div class="glow" aria-hidden="true"></div>
	<div class="locale-corner">
		<LocaleSwitch />
	</div>
	<div class="copy">
		<p class="brand">HERMES</p>
		<h1>{t('gate.accessRestricted', locale)}</h1>
	</div>
</div>

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
		padding: 1.5rem;
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
		text-shadow: 0 0 24px rgba(94, 231, 255, 0.12);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.15rem, 3.5vw, 1.5rem);
		font-weight: 500;
		letter-spacing: 0.02em;
	}
</style>
