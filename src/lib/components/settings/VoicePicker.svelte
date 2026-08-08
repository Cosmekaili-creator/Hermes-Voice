<script lang="ts">
	import { getLocale, t } from '$lib/i18n';
	import { listVoices as listOpenaiVoices } from '$lib/providers/openai/voices';
	import { listVoices as listXaiVoicesFallback } from '$lib/providers/xai/voices';

	type XaiVoiceRow = { id: string; name: string; language?: string };

	/**
	 * Deliberately primitive props (not a `SettingsForm` instance) — this component is
	 * shared between the settings modal (`ProviderFields.svelte`, chunk A/B, ops-level
	 * `XAI_VOICE`/`OPENAI_VOICE` env override) and the per-user persona editor
	 * (`owner/users/+page.svelte`, chunk C, per-binding `voiceId`), which have unrelated
	 * surrounding state shapes.
	 */
	let {
		provider,
		voiceId,
		onSelect,
		xaiApiKeyOverride,
		disabled = false,
		saved = false,
		onReconnect
	}: {
		provider: 'xai' | 'openai';
		voiceId: string | null;
		onSelect: (id: string | null) => void;
		/** Not-yet-saved typed xAI key, so "Load voices" works before a key is saved. */
		xaiApiKeyOverride?: string;
		disabled?: boolean;
		/** Gates the "Reconnect now" affordance — true right after a successful save. */
		saved?: boolean;
		onReconnect?: () => void;
	} = $props();

	let xaiVoices = $state<XaiVoiceRow[]>([]);
	let xaiLoading = $state(false);
	let xaiLoadError = $state<string | null>(null);
	let xaiLoaded = $state(false);
	// m3: true when xaiVoices was populated from the static offline fallback
	// (xai/voices.ts) after the live /api/setup/voices/xai fetch failed, not from a
	// real live response — used to render an accurate "showing default" hint instead
	// of implying the live list loaded successfully.
	let xaiIsFallback = $state(false);

	const openaiVoices = listOpenaiVoices();

	// Flat unless the live response actually contains more than one distinct language —
	// don't fabricate a language-grouping UI the data doesn't support.
	const xaiLanguages = $derived.by(() => {
		const set = new Set(xaiVoices.map((v) => v.language).filter((v): v is string => Boolean(v)));
		return set;
	});

	/** Static minimal list (currently just "eve"), used when the live fetch fails. */
	function useXaiFallback() {
		xaiVoices = listXaiVoicesFallback();
		xaiIsFallback = true;
		xaiLoaded = true;
	}

	async function loadXaiVoices() {
		if (xaiLoading) return;
		xaiLoading = true;
		xaiLoadError = null;
		xaiIsFallback = false;
		try {
			const res = await fetch('/api/setup/voices/xai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ xaiApiKey: xaiApiKeyOverride || undefined })
			});
			const data = (await res.json().catch(() => null)) as null | {
				ok?: boolean;
				voices?: XaiVoiceRow[];
				code?: string;
			};
			if (!data?.ok || !data.voices) {
				xaiLoadError = data?.code || 'generic';
				useXaiFallback();
				return;
			}
			xaiVoices = data.voices;
			xaiLoaded = true;
		} catch {
			xaiLoadError = 'generic';
			useXaiFallback();
		} finally {
			xaiLoading = false;
		}
	}
</script>

<div class="voice-picker">
	<span class="voice-picker__label">{t('settings.voice.label', getLocale())}</span>

	<div
		class="voice-picker__options"
		role="radiogroup"
		aria-label={t('settings.voice.label', getLocale())}
	>
		<button
			type="button"
			class="voice-picker__opt"
			class:voice-picker__opt--active={voiceId === null}
			{disabled}
			onclick={() => onSelect(null)}
		>
			{t('settings.voice.providerDefault', getLocale())}
		</button>

		{#if provider === 'openai'}
			{#each openaiVoices as v (v.id)}
				<button
					type="button"
					class="voice-picker__opt"
					class:voice-picker__opt--active={voiceId === v.id}
					{disabled}
					onclick={() => onSelect(v.id)}
				>
					{v.name}
					{#if v.recommended}<span class="voice-picker__badge"
							>{t('settings.voice.recommended', getLocale())}</span
						>{/if}
				</button>
			{/each}
			<p class="voice-picker__hint">{t('settings.voice.openaiHint', getLocale())}</p>
		{:else}
			{#if !xaiLoaded}
				<button
					type="button"
					class="voice-picker__load"
					disabled={disabled || xaiLoading}
					onclick={loadXaiVoices}
				>
					{xaiLoading
						? t('settings.voice.loading', getLocale())
						: t('settings.voice.load', getLocale())}
				</button>
			{/if}
			{#if xaiLoadError}
				<p class="voice-picker__error" role="alert">{t('settings.voice.loadError', getLocale())}</p>
			{/if}
			{#if xaiVoices.length > 0}
				{#if xaiLanguages.size > 1}
					{#each [...xaiLanguages] as lang (lang)}
						<p class="voice-picker__group">{lang}</p>
						{#each xaiVoices.filter((v) => v.language === lang) as v (v.id)}
							<button
								type="button"
								class="voice-picker__opt"
								class:voice-picker__opt--active={voiceId === v.id}
								{disabled}
								onclick={() => onSelect(v.id)}
							>
								{v.name}
							</button>
						{/each}
					{/each}
				{:else}
					{#each xaiVoices as v (v.id)}
						<button
							type="button"
							class="voice-picker__opt"
							class:voice-picker__opt--active={voiceId === v.id}
							{disabled}
							onclick={() => onSelect(v.id)}
						>
							{v.name}
						</button>
					{/each}
				{/if}
				{#if xaiIsFallback}
					<p class="voice-picker__hint">{t('settings.voice.fallbackNote', getLocale())}</p>
				{/if}
			{/if}
		{/if}
	</div>

	<p class="voice-picker__hint">{t('settings.voice.nextSessionNote', getLocale())}</p>

	{#if saved && onReconnect}
		<button type="button" class="voice-picker__reconnect" onclick={() => onReconnect?.()}>
			{t('settings.voice.reconnectNow', getLocale())}
		</button>
	{/if}
</div>

<style>
	.voice-picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.voice-picker__label {
		font-size: 0.85rem;
		color: var(--muted, #8eb8bc);
	}

	.voice-picker__options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.voice-picker__opt,
	.voice-picker__load,
	.voice-picker__reconnect {
		min-height: 2.1rem;
		padding: 0.35rem 0.75rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(202, 253, 255, 0.28);
		background: rgba(3, 10, 12, 0.45);
		color: var(--ink, #e8f7f8);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.voice-picker__opt--active {
		border-color: rgba(94, 231, 255, 0.65);
		background: rgba(94, 231, 255, 0.16);
	}

	.voice-picker__opt:disabled,
	.voice-picker__load:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.voice-picker__badge {
		margin-left: 0.35rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: rgba(94, 231, 255, 0.18);
		font-size: 0.68rem;
		letter-spacing: 0.03em;
	}

	.voice-picker__group {
		width: 100%;
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted, #8eb8bc);
	}

	.voice-picker__hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted, #8eb8bc);
	}

	.voice-picker__error {
		margin: 0;
		font-size: 0.8rem;
		color: #ff8f8f;
	}

	.voice-picker__reconnect {
		align-self: flex-start;
		border-color: rgba(94, 231, 255, 0.45);
	}
</style>
