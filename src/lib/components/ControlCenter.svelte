<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { t } from '$lib/i18n';
	import type { ProviderId } from '$lib/providers/types';
	import type { TalkMode } from '$lib/voice/voiceDemo';
	import LocaleSwitch from './LocaleSwitch.svelte';
	import TalkModeSwitch from './TalkModeSwitch.svelte';

	const PROVIDER_LABELS: Record<ProviderId, string> = { xai: 'xAI', openai: 'OpenAI' };

	let {
		open,
		talkMode,
		provider,
		isOwner,
		confirmActions,
		speechInTimeline,
		onClose,
		onTalkMode,
		onOpenSettings,
		onAmbient,
		onConfirmActions,
		onSpeechInTimeline
	}: {
		open: boolean;
		talkMode: TalkMode;
		provider: ProviderId;
		isOwner: boolean;
		confirmActions: boolean;
		speechInTimeline: boolean;
		onClose: () => void;
		onTalkMode: (mode: TalkMode) => void;
		onOpenSettings: (section: 'provider' | 'hermes') => void;
		onAmbient: () => void;
		onConfirmActions: (on: boolean) => void;
		onSpeechInTimeline: (on: boolean) => void;
	} = $props();

	let panelEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (open) void tick().then(() => panelEl?.focus());
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onClose();
		}
	}

	let dragStartY: number | null = null;
	function onGrabDown(e: PointerEvent) {
		dragStartY = e.clientY;
	}
	function onGrabUp(e: PointerEvent) {
		if (dragStartY !== null && dragStartY - e.clientY > 50) onClose();
		dragStartY = null;
	}
</script>

{#if open}
	<button
		type="button"
		class="scrim"
		tabindex="-1"
		aria-label={t('control.close')}
		transition:fade={{ duration: 150 }}
		onclick={onClose}
	></button>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-labelledby="control-title"
		tabindex="-1"
		bind:this={panelEl}
		onkeydown={onKeydown}
		transition:fly={{ y: -360, duration: 240 }}
	>
		<h2 class="panel__title" id="control-title">{t('control.title')}</h2>

		<div class="group">
			<p class="group__label">{t('meta.talkMode')}</p>
			<div class="wide-switch"><TalkModeSwitch mode={talkMode} onChange={onTalkMode} /></div>
		</div>

		<div class="group">
			<p class="group__label">{t('meta.language')}</p>
			<div class="wide-switch"><LocaleSwitch /></div>
		</div>

		<div class="tiles">
			{#if isOwner}
				<button type="button" class="tile" onclick={() => onOpenSettings('provider')}>
					<span class="tile__label">{t('meta.provider')}</span>
					<span class="tile__value provider-badge">{PROVIDER_LABELS[provider]}</span>
				</button>
			{:else}
				<div class="tile tile--inert">
					<span class="tile__label">{t('meta.provider')}</span>
					<span class="tile__value">{PROVIDER_LABELS[provider]}</span>
				</div>
			{/if}
			<button type="button" class="tile" onclick={onAmbient}>
				<span class="tile__label">{t('control.display')}</span>
				<span class="tile__value">{t('control.ambient')}</span>
			</button>
		</div>

		<div class="toggles">
			<label class="toggle">
				<span class="toggle__text">{t('control.confirmActions')}</span>
				<input
					type="checkbox"
					class="toggle__input"
					checked={confirmActions}
					onchange={(e) => onConfirmActions(e.currentTarget.checked)}
				/>
			</label>
			<label class="toggle">
				<span class="toggle__text">
					{t('control.speechInTimeline')}
					<span class="toggle__hint">{t('control.speechInTimelineHint')}</span>
				</span>
				<input
					type="checkbox"
					class="toggle__input"
					checked={speechInTimeline}
					onchange={(e) => onSpeechInTimeline(e.currentTarget.checked)}
				/>
			</label>
		</div>

		{#if isOwner}
			<div class="group">
				<p class="group__label">{t('control.owner')}</p>
				<nav class="links" aria-label={t('control.owner')}>
					<button type="button" class="link settings-gear" onclick={() => onOpenSettings('hermes')}>
						{t('control.hermes')}<span aria-hidden="true">›</span>
					</button>
					<a class="link" href="/owner/users"
						>{t('control.users')}<span aria-hidden="true">›</span></a
					>
					<a class="link" href="/owner/health"
						>{t('control.health')}<span aria-hidden="true">›</span></a
					>
				</nav>
			</div>
		{/if}

		<div class="grab" onpointerdown={onGrabDown} onpointerup={onGrabUp} aria-hidden="true">
			<span class="grab__handle"></span>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: none;
		padding: 0;
		background: rgba(1, 6, 7, 0.55);
		cursor: default;
	}

	.panel {
		position: fixed;
		z-index: 21;
		top: 0;
		left: 50%;
		translate: -50% 0;
		width: min(30rem, 100vw);
		box-sizing: border-box;
		max-height: 92dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		padding: calc(1.25rem + env(safe-area-inset-top)) 1.25rem 0.6rem;
		border: 1px solid rgba(142, 184, 188, 0.25);
		border-top: none;
		border-radius: 0 0 1.75rem 1.75rem;
		background: #0a1b1e;
		color: #e8f7f8;
		font-family: 'DM Sans', system-ui, sans-serif;
		outline: none;
	}

	.panel__title {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.35rem;
		font-weight: 500;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.group__label {
		margin: 0;
		color: #8eb8bc;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.wide-switch :global(.talk-mode),
	.wide-switch :global(.locale) {
		display: flex;
		width: 100%;
		box-sizing: border-box;
	}

	.wide-switch :global(.talk-mode__btn),
	.wide-switch :global(.locale__btn) {
		flex: 1;
		min-height: 2.75rem;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.tile {
		min-height: 4rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0 0.9rem;
		border: 1px solid rgba(142, 184, 188, 0.3);
		border-radius: 1rem;
		background: transparent;
		color: #e8f7f8;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.tile--inert {
		cursor: default;
	}

	.tile__label {
		color: #8eb8bc;
		font-size: 0.75rem;
	}

	.tile__value {
		font-size: 0.98rem;
	}

	.toggles {
		display: flex;
		flex-direction: column;
		border-top: 1px solid rgba(142, 184, 188, 0.15);
	}

	.toggle {
		min-height: 3.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid rgba(142, 184, 188, 0.15);
		cursor: pointer;
	}

	.toggle__text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		font-size: 0.92rem;
	}

	.toggle__hint {
		color: #8eb8bc;
		font-size: 0.74rem;
	}

	.toggle__input {
		flex: none;
		appearance: none;
		width: 2.9rem;
		height: 1.7rem;
		margin: 0;
		border-radius: 999px;
		border: 1px solid rgba(142, 184, 188, 0.45);
		background: rgba(3, 10, 12, 0.6);
		position: relative;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.toggle__input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 50%;
		background: #8eb8bc;
		transition: translate 0.15s ease;
	}

	.toggle__input:checked {
		background: rgba(94, 231, 255, 0.3);
		border-color: #5ee7ff;
	}

	.toggle__input:checked::after {
		translate: 1.2rem 0;
		background: #cafdff;
	}

	.links {
		display: flex;
		flex-direction: column;
	}

	.link {
		min-height: 3rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0;
		border: none;
		border-bottom: 1px solid rgba(142, 184, 188, 0.15);
		background: transparent;
		color: #e8f7f8;
		font: inherit;
		font-size: 0.95rem;
		text-decoration: none;
		cursor: pointer;
	}

	.link span {
		color: #8eb8bc;
	}

	.tile:focus-visible,
	.link:focus-visible,
	.toggle__input:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}

	.grab {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0 0.4rem;
		touch-action: none;
		cursor: grab;
	}

	.grab__handle {
		width: 2.75rem;
		height: 5px;
		border-radius: 3px;
		background: rgba(202, 253, 255, 0.28);
	}

	@media (prefers-reduced-motion: reduce) {
		.toggle__input,
		.toggle__input::after {
			transition: none;
		}
	}
</style>
