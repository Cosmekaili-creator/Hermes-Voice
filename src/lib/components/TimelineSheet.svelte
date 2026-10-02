<script lang="ts">
	import { tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { t, type MessageKey } from '$lib/i18n';
	import ResultCards from './ResultCards.svelte';
	import {
		exportTimelineText,
		filterEntries,
		type TimelineEntry,
		type TimelineTaskStatus
	} from '$lib/voice/timeline.svelte';

	let {
		open,
		entries,
		assistantName,
		onClose,
		onClear
	}: {
		open: boolean;
		entries: TimelineEntry[];
		assistantName: string;
		onClose: () => void;
		onClear: () => void;
	} = $props();

	let query = $state('');
	let searching = $state(false);
	let listEl: HTMLDivElement | undefined = $state();
	let sheetEl: HTMLDivElement | undefined = $state();
	let copiedId = $state<string | null>(null);

	const visible = $derived(filterEntries(entries, query));

	const TASK_LABEL: Record<TimelineTaskStatus, MessageKey> = {
		queued: 'task.status.queued',
		running: 'task.status.running',
		done: 'task.status.done',
		failed: 'task.status.failed'
	};

	function timeOf(at: number): string {
		return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	/** Show a time divider when 5+ minutes passed since the previous entry. */
	function showDivider(i: number): boolean {
		if (i === 0) return true;
		return visible[i]!.at - visible[i - 1]!.at > 5 * 60_000;
	}

	$effect(() => {
		if (!open) return;
		void visible.length;
		void tick().then(() => {
			if (listEl && !query) listEl.scrollTop = listEl.scrollHeight;
		});
	});

	$effect(() => {
		if (open) void tick().then(() => sheetEl?.focus());
	});

	/** Window-level so Escape works wherever focus is (and background content is inert). */
	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopPropagation();
			onClose();
		}
	}

	async function copy(entry: TimelineEntry) {
		if (entry.kind !== 'assistant' && entry.kind !== 'user') return;
		try {
			await navigator.clipboard.writeText(entry.text);
			copiedId = entry.id;
			setTimeout(() => {
				if (copiedId === entry.id) copiedId = null;
			}, 1500);
		} catch {
			/* clipboard blocked — nothing useful to show */
		}
	}

	function exportAll() {
		const text = exportTimelineText(entries, {
			you: t('timeline.you'),
			assistant: assistantName
		});
		const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${assistantName.toLowerCase()}-conversation-${new Date().toISOString().slice(0, 10)}.txt`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function clearAll() {
		if (confirm(t('timeline.clearConfirm'))) onClear();
	}

	// Swipe the handle down to dismiss.
	let dragStartY: number | null = null;
	function onHandleDown(e: PointerEvent) {
		dragStartY = e.clientY;
	}
	function onHandleUp(e: PointerEvent) {
		if (dragStartY !== null && e.clientY - dragStartY > 60) onClose();
		dragStartY = null;
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<button
		type="button"
		class="scrim"
		tabindex="-1"
		aria-label={t('timeline.close')}
		transition:fade={{ duration: 160 }}
		onclick={onClose}
	></button>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-labelledby="timeline-title"
		tabindex="-1"
		bind:this={sheetEl}
		transition:fly={{ y: 420, duration: 260 }}
	>
		<div
			class="sheet__grab"
			onpointerdown={onHandleDown}
			onpointerup={onHandleUp}
			aria-hidden="true"
		>
			<span class="sheet__handle"></span>
		</div>
		<header class="sheet__head">
			<h2 class="sheet__title" id="timeline-title">{t('timeline.title')}</h2>
			<div class="sheet__tools">
				<button
					type="button"
					class="icon-btn"
					aria-label={t('timeline.search')}
					aria-pressed={searching}
					onclick={() => {
						searching = !searching;
						if (!searching) query = '';
					}}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
						><circle
							cx="11"
							cy="11"
							r="7"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						/><path
							d="M20 20l-4-4"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/></svg
					>
				</button>
				<button
					type="button"
					class="icon-btn"
					aria-label={t('timeline.export')}
					disabled={entries.length === 0}
					onclick={exportAll}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
						><path
							d="M12 3v12M7 10l5 5 5-5M5 21h14"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
				</button>
				<button
					type="button"
					class="icon-btn"
					aria-label={t('timeline.clear')}
					disabled={entries.length === 0}
					onclick={clearAll}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
						><path
							d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
				</button>
				<button type="button" class="icon-btn" aria-label={t('timeline.close')} onclick={onClose}>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
						><path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/></svg
					>
				</button>
			</div>
		</header>
		{#if searching}
			<label class="search">
				<span class="visually-hidden">{t('timeline.search')}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="search"
					class="search__input"
					placeholder={t('timeline.search')}
					bind:value={query}
					autofocus
				/>
			</label>
		{/if}
		<div class="sheet__list" bind:this={listEl} aria-live="polite">
			{#if entries.length === 0}
				<p class="empty">{t('timeline.empty')}</p>
			{:else if visible.length === 0}
				<p class="empty">{t('timeline.noMatches')}</p>
			{/if}
			{#each visible as entry, i (entry.id)}
				{#if showDivider(i)}
					<p class="divider">{timeOf(entry.at)}</p>
				{/if}
				{#if entry.kind === 'user'}
					<div class="row row--user">
						<p class="bubble bubble--user">{entry.text}</p>
					</div>
				{:else if entry.kind === 'assistant'}
					<div class="row row--assistant">
						<div class="bubble bubble--assistant">
							<p class="bubble__text">{entry.text}</p>
							<button type="button" class="chip-btn" onclick={() => copy(entry)}>
								{copiedId === entry.id ? t('timeline.copied') : t('timeline.copy')}
							</button>
						</div>
					</div>
				{:else if entry.kind === 'tool'}
					<p class="meta"><span class="dot"></span>{assistantName} · {entry.label}</p>
				{:else if entry.kind === 'task'}
					<p class="meta meta--task meta--{entry.status}">
						<span class="dot"></span>{entry.title || t('task.untitled')} · {t(
							TASK_LABEL[entry.status]
						)}
					</p>
				{:else if entry.kind === 'approval'}
					<p class="meta meta--approval meta--{entry.status}">
						<span class="dot"></span>{entry.summary} ·
						{entry.status === 'approved'
							? t('approval.approved')
							: entry.status === 'declined'
								? t('approval.declined')
								: t('approval.heading')}
					</p>
				{:else if entry.kind === 'cards'}
					<div class="row row--assistant row--cards">
						<ResultCards cards={entry.cards} compact />
					</div>
				{/if}
			{/each}
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

	.sheet {
		position: fixed;
		z-index: 21;
		left: 50%;
		bottom: 0;
		translate: -50% 0;
		width: min(36rem, 100vw);
		height: min(82dvh, 46rem);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		border: 1px solid rgba(142, 184, 188, 0.25);
		border-bottom: none;
		border-radius: 1.6rem 1.6rem 0 0;
		background: #0a1b1e;
		color: #e8f7f8;
		font-family: 'DM Sans', system-ui, sans-serif;
		outline: none;
		padding-bottom: env(safe-area-inset-bottom);
	}

	.sheet__grab {
		display: flex;
		justify-content: center;
		padding: 0.6rem 0 0.2rem;
		touch-action: none;
		cursor: grab;
	}

	.sheet__handle {
		width: 2.75rem;
		height: 5px;
		border-radius: 3px;
		background: rgba(202, 253, 255, 0.28);
	}

	.sheet__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 1rem 0.5rem 1.25rem;
	}

	.sheet__title {
		margin: 0;
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.35rem;
		font-weight: 500;
	}

	.sheet__tools {
		display: flex;
		gap: 0.35rem;
	}

	.icon-btn {
		width: 2.75rem;
		height: 2.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(142, 184, 188, 0.3);
		border-radius: 999px;
		background: transparent;
		color: #cafdff;
		cursor: pointer;
	}

	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.icon-btn[aria-pressed='true'] {
		border-color: #5ee7ff;
		background: rgba(94, 231, 255, 0.12);
	}

	.icon-btn:focus-visible,
	.chip-btn:focus-visible,
	.search__input:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}

	.search {
		padding: 0 1.25rem 0.6rem;
	}

	.search__input {
		width: 100%;
		box-sizing: border-box;
		height: 2.75rem;
		padding: 0 1rem;
		border: 1px solid rgba(142, 184, 188, 0.35);
		border-radius: 999px;
		background: rgba(3, 10, 12, 0.6);
		color: #e8f7f8;
		font: inherit;
		font-size: 0.95rem;
	}

	.sheet__list {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.25rem 1.25rem 1.5rem;
	}

	.empty {
		margin: 2rem 0;
		color: #8eb8bc;
		text-align: center;
		font-size: 0.9rem;
	}

	.divider {
		margin: 0.4rem 0 0;
		color: #6f9ca0;
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		text-align: center;
	}

	.row {
		display: flex;
	}

	.row--user {
		justify-content: flex-end;
	}

	.row--cards {
		width: 88%;
	}

	.bubble {
		margin: 0;
		max-width: 84%;
		padding: 0.6rem 0.85rem;
		font-size: 0.95rem;
		line-height: 1.42;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.bubble--user {
		border-radius: 1.1rem 1.1rem 0.25rem 1.1rem;
		background: #17464c;
	}

	.bubble--assistant {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.45rem;
		border: 1px solid rgba(142, 184, 188, 0.2);
		border-radius: 1.1rem 1.1rem 1.1rem 0.25rem;
		background: #0f2a2e;
	}

	.bubble__text {
		margin: 0;
	}

	.chip-btn {
		min-height: 2rem;
		padding: 0 0.75rem;
		border: 1px solid rgba(142, 184, 188, 0.3);
		border-radius: 999px;
		background: transparent;
		color: #a9d2d6;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.meta {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding-left: 0.2rem;
		color: #8eb8bc;
		font-size: 0.78rem;
		line-height: 1.3;
	}

	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #5ee7ff;
	}

	.meta--queued .dot {
		background: #6f9ca0;
	}

	.meta--failed .dot,
	.meta--declined .dot {
		background: #f08a7e;
	}

	.meta--approval.meta--pending .dot {
		background: #e7b75e;
	}

	.meta--done .dot,
	.meta--approved .dot {
		background: #cafdff;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
