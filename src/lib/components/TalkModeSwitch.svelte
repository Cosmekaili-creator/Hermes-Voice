<script lang="ts">
	import { t } from '$lib/i18n';
	import type { TalkMode } from '$lib/voice/voiceDemo';

	let {
		mode,
		onChange
	}: {
		mode: TalkMode;
		onChange: (mode: TalkMode) => void;
	} = $props();

	const groupLabel = $derived(t('meta.talkMode'));
	const pttLabel = $derived(t('mode.ptt'));
	const handsfreeLabel = $derived(t('mode.handsfree'));
</script>

<div class="talk-mode" role="group" aria-label={groupLabel}>
	<button
		type="button"
		class="talk-mode__btn"
		class:talk-mode__btn--active={mode === 'ptt'}
		aria-pressed={mode === 'ptt'}
		title={pttLabel}
		onclick={() => onChange('ptt')}
	>
		{pttLabel}
	</button>
	<button
		type="button"
		class="talk-mode__btn"
		class:talk-mode__btn--active={mode === 'handsfree'}
		aria-pressed={mode === 'handsfree'}
		title={handsfreeLabel}
		onclick={() => onChange('handsfree')}
	>
		{handsfreeLabel}
	</button>
</div>

<style>
	.talk-mode {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid rgba(202, 253, 255, 0.22);
		border-radius: 999px;
		background: rgba(4, 20, 24, 0.55);
		backdrop-filter: blur(6px);
	}

	.talk-mode__btn {
		min-height: 1.8rem;
		padding: 0.2rem 0.55rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: #8eb8bc;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.03em;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}

	.talk-mode__btn:hover {
		color: #e8f7f8;
	}

	.talk-mode__btn:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 1px;
	}

	.talk-mode__btn--active {
		background: rgba(94, 231, 255, 0.16);
		color: #e8f7f8;
	}
</style>
