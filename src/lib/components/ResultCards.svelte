<script lang="ts">
	import { t, type MessageKey } from '$lib/i18n';
	import type { ResultCard } from '$lib/cards';

	let {
		cards,
		compact = false,
		row = false
	}: { cards: ResultCard[]; compact?: boolean; row?: boolean } = $props();

	const KIND_LABEL: Record<ResultCard['type'], MessageKey> = {
		event: 'cards.event',
		email: 'cards.email',
		link: 'cards.link',
		contact: 'cards.contact',
		note: 'cards.note'
	};
</script>

<ul class="cards" class:cards--compact={compact} class:cards--row={row}>
	{#each cards as card, i (i)}
		<li class="card card--{card.type}">
			<span class="card__kind">{t(KIND_LABEL[card.type])}</span>
			{#if card.type === 'link'}
				<a class="card__title card__link" href={card.url} target="_blank" rel="noopener noreferrer"
					>{card.title}<span aria-hidden="true"> ›</span></a
				>
				{#if card.detail}<span class="card__detail">{card.detail}</span>{/if}
			{:else}
				<span class="card__title">{card.title}</span>
				{#if card.type === 'event'}
					{#if card.when}<span class="card__detail">{card.when}</span>{/if}
					{#if card.where}<span class="card__detail">{card.where}</span>{/if}
				{:else if card.type === 'email'}
					{#if card.from || card.to}
						<span class="card__detail"
							>{card.from ?? ''}{card.from && card.to ? ' → ' : ''}{card.to ?? ''}</span
						>
					{/if}
					{#if card.snippet}<span class="card__detail card__snippet">{card.snippet}</span>{/if}
				{:else if card.detail}
					<span class="card__detail">{card.detail}</span>
				{/if}
			{/if}
		</li>
	{/each}
</ul>

<style>
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.85rem 0.7rem 1rem;
		border: 1px solid rgba(142, 184, 188, 0.25);
		border-radius: 1rem;
		background: rgba(10, 27, 30, 0.88);
		position: relative;
		overflow: hidden;
	}

	.card::before {
		content: '';
		position: absolute;
		left: 0.45rem;
		top: 0.75rem;
		bottom: 0.75rem;
		width: 3px;
		border-radius: 2px;
		background: #5ee7ff;
	}

	.card--email::before {
		background: #e7b75e;
	}

	.card--contact::before,
	.card--note::before {
		background: #8eb8bc;
	}

	.card__kind {
		color: #8eb8bc;
		font-size: 0.66rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.card__title {
		color: #e8f7f8;
		font-size: 0.95rem;
		font-weight: 500;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.card__link {
		color: #cafdff;
		text-decoration: none;
	}

	.card__link:hover,
	.card__link:focus-visible {
		text-decoration: underline;
	}

	.card__detail {
		color: #a9d2d6;
		font-size: 0.82rem;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.card__snippet {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	.cards--compact .card {
		padding: 0.55rem 0.75rem 0.55rem 0.95rem;
	}

	/* One horizontal strip of single-line cards (Lounge tray) — never taller than one card. */
	.cards--row {
		flex-direction: row;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		padding-bottom: 2px;
	}

	.cards--row::-webkit-scrollbar {
		display: none;
	}

	.cards--row .card {
		flex: 0 0 min(17rem, 78vw);
		scroll-snap-align: start;
	}

	.cards--row .card__title,
	.cards--row .card__detail {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cards--row .card__snippet {
		display: block;
	}
</style>
