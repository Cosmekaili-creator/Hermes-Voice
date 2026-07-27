<script lang="ts">
	import { t } from '$lib/i18n';

	let { enabled, onSend }: { enabled: boolean; onSend: (text: string) => void } = $props();

	let draft = $state('');

	const canSubmit = $derived(enabled && draft.trim().length > 0);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		const text = draft;
		draft = '';
		onSend(text);
	}
</script>

<form class="composer" onsubmit={submit}>
	<input
		class="composer__input"
		type="text"
		autocomplete="off"
		autocapitalize="sentences"
		enterkeyhint="send"
		maxlength="500"
		placeholder={t('compose.placeholder')}
		aria-label={t('compose.label')}
		disabled={!enabled}
		bind:value={draft}
	/>
	<button type="submit" class="composer__send" aria-label={t('compose.send')} disabled={!canSubmit}>
		<span aria-hidden="true">↑</span>
	</button>
</form>

<style>
	.composer {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: min(28rem, calc(100vw - 3rem));
	}
	.composer__input {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 2.4rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
		color: #e8f7f8;
		font: inherit;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
	}
	.composer__input::placeholder {
		color: #8eb8bc;
		opacity: 0.8;
	}
	.composer__input:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}
	.composer__input:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.composer__send {
		flex: 0 0 auto;
		width: 2.4rem;
		min-height: 2.4rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.7);
		color: #e8f7f8;
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		backdrop-filter: blur(6px);
	}
	.composer__send:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.composer__send:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}
</style>
