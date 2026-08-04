<script lang="ts">
	import { getLocale, t } from '$lib/i18n';

	let { onDismiss, assistantName }: { onDismiss: () => void; assistantName: string } = $props();
</script>

<div class="primer" role="status">
	<p class="primer__title">{t('mic.primerTitle')}</p>
	<p class="primer__body">{t('mic.primerBody', getLocale(), assistantName)}</p>
	<button type="button" class="primer__btn" onclick={onDismiss}>{t('mic.primerDismiss')}</button>
</div>

<style>
	.primer {
		width: min(24rem, calc(100vw - 3rem));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 0.9rem;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
		color: #8eb8bc;
		font-family: inherit;
		text-align: left;
	}
	.primer__title {
		margin: 0;
		color: #e8f7f8;
		font-size: 0.8rem;
		font-weight: 500;
		letter-spacing: 0.03em;
	}
	.primer__body {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.35;
		letter-spacing: 0.02em;
	}
	.primer__btn {
		align-self: flex-end;
		min-height: 1.8rem;
		padding: 0.2rem 0.7rem;
		border: none;
		border-radius: 999px;
		background: rgba(94, 231, 255, 0.16);
		color: #e8f7f8;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 500;
		cursor: pointer;
	}
	.primer__btn:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 1px;
	}
</style>
