<script lang="ts">
	import { fly } from 'svelte/transition';
	import { t } from '$lib/i18n';
	import type { PendingApproval } from '$lib/voice/approvals';

	let {
		approval,
		assistantName,
		onApprove,
		onDecline
	}: {
		approval: PendingApproval;
		assistantName: string;
		onApprove: () => void;
		onDecline: () => void;
	} = $props();

	let showDetails = $state(false);
</script>

<div
	class="approval"
	role="alertdialog"
	tabindex="-1"
	aria-labelledby="approval-title"
	aria-describedby="approval-summary"
	transition:fly={{ y: 24, duration: 220 }}
>
	<p class="approval__kicker" id="approval-title">
		<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
			<path
				d="M12 3l9 16H3z M12 10v4 M12 17v.5"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		{t('approval.heading')}
	</p>
	<p class="approval__summary" id="approval-summary">{approval.summary}</p>
	<button
		type="button"
		class="approval__toggle"
		aria-expanded={showDetails}
		onclick={() => (showDetails = !showDetails)}
	>
		{t('approval.details', undefined, assistantName)}
	</button>
	{#if showDetails}
		<p class="approval__request">{approval.request}</p>
	{/if}
	<div class="approval__actions">
		<button type="button" class="approval__btn approval__btn--ghost" onclick={onDecline}
			>{t('approval.decline')}</button
		>
		<button type="button" class="approval__btn approval__btn--primary" onclick={onApprove}
			>{t('approval.approve')}</button
		>
	</div>
	<p class="approval__hint">{t('approval.voiceHint')}</p>
</div>

<style>
	.approval {
		width: min(26rem, calc(100vw - 2rem));
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem 1.1rem;
		border: 1px solid #e7b75e;
		border-radius: 1.3rem;
		background: rgba(18, 38, 42, 0.96);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
		color: #e8f7f8;
		text-align: left;
	}

	.approval__kicker {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #e7b75e;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.approval__summary {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 500;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.approval__toggle {
		align-self: flex-start;
		min-height: 2rem;
		padding: 0;
		border: none;
		background: none;
		color: #a9d2d6;
		font: inherit;
		font-size: 0.8rem;
		text-decoration: underline;
		cursor: pointer;
	}

	.approval__request {
		margin: 0;
		max-height: 8rem;
		overflow-y: auto;
		padding: 0.6rem 0.7rem;
		border-radius: 0.7rem;
		background: rgba(3, 10, 12, 0.6);
		color: #c9e4e6;
		font-size: 0.85rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.approval__actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.approval__btn {
		min-height: 3rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.approval__btn--ghost {
		border: 1px solid rgba(142, 184, 188, 0.45);
		background: transparent;
		color: #e8f7f8;
	}

	.approval__btn--primary {
		border: none;
		background: #cafdff;
		color: #062023;
		font-weight: 500;
	}

	.approval__btn:focus-visible,
	.approval__toggle:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}

	.approval__hint {
		margin: 0;
		color: #8eb8bc;
		font-size: 0.75rem;
		text-align: center;
	}
</style>
