<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fly, scale } from 'svelte/transition';
	import { t, type MessageKey } from '$lib/i18n';
	import ResultCards from './ResultCards.svelte';
	import type { OrbitTask } from '$lib/voice/orbit';

	let {
		tasks,
		radius,
		onCancel,
		onSpeak,
		selectedId = $bindable(null)
	}: {
		tasks: OrbitTask[];
		/** Orb ring radius in CSS px — satellites sit outside the spectrum bars. */
		radius: number;
		onCancel: (id: string) => void;
		onSpeak: () => void;
		/** Bindable so the Lounge can make room (hide the card tray) while a task card is open. */
		selectedId?: string | null;
	} = $props();
	let now = $state(Date.now());
	const clock = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(clock));

	const selected = $derived(tasks.find((task) => task.id === selectedId) ?? null);

	$effect(() => {
		if (selectedId && !selected) selectedId = null;
	});

	const STATUS_LABEL: Record<OrbitTask['status'], MessageKey> = {
		queued: 'task.status.queued',
		running: 'task.status.running',
		done: 'task.status.done',
		failed: 'task.status.failed'
	};

	/** Fan satellites over the upper-left → right arc so they never cover the wordmark. */
	function position(i: number) {
		const orbit = radius * 1.62;
		const start = -150;
		const step = Math.min(38, 300 / Math.max(1, tasks.length));
		const a = ((start + i * step) * Math.PI) / 180;
		return { x: Math.cos(a) * orbit, y: Math.sin(a) * orbit };
	}

	function elapsed(task: OrbitTask): string {
		const from = Date.parse(task.startedAt ?? task.createdAt);
		const to = task.finishedAt ? Date.parse(task.finishedAt) : now;
		if (!Number.isFinite(from)) return '';
		const sec = Math.max(0, Math.round((to - from) / 1000));
		return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
	}
</script>

{#if tasks.length > 0}
	<div class="orbit" role="group" aria-label={t('tasks.orbitLabel')}>
		{#each tasks as task, i (task.id)}
			{@const p = position(i)}
			<button
				type="button"
				class="sat sat--{task.status}"
				class:sat--selected={selectedId === task.id}
				style:translate="{p.x}px {p.y}px"
				aria-label="{task.title || t('task.untitled')} — {t(STATUS_LABEL[task.status])}"
				aria-pressed={selectedId === task.id}
				onclick={() => (selectedId = selectedId === task.id ? null : task.id)}
				transition:scale={{ duration: 200 }}
			>
				<span class="sat__core" aria-hidden="true"></span>
			</button>
		{/each}
	</div>
{/if}

{#if selected}
	<section
		class="task-card"
		aria-labelledby="task-card-title"
		transition:fly={{ y: 20, duration: 200 }}
	>
		<div class="task-card__head">
			<p class="task-card__status task-card__status--{selected.status}">
				<span class="task-card__dot" aria-hidden="true"></span>
				{t(STATUS_LABEL[selected.status])}
				{#if selected.status !== 'queued'}<span class="task-card__time">· {elapsed(selected)}</span
					>{/if}
			</p>
			<button
				type="button"
				class="task-card__close"
				aria-label={t('task.close')}
				onclick={() => (selectedId = null)}
			>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"
					><path
						d="M6 6l12 12M18 6L6 18"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/></svg
				>
			</button>
		</div>
		<h3 class="task-card__title" id="task-card-title">{selected.title || t('task.untitled')}</h3>
		{#if selected.progress.length > 0 || selected.status === 'running'}
			<ol class="task-card__feed">
				{#each selected.progress as step, i (i)}
					<li
						class:task-card__feed--current={i === selected.progress.length - 1 &&
							selected.status === 'running'}
					>
						{step}
					</li>
				{/each}
				{#if selected.progress.length === 0}
					<li class="task-card__feed--current">{t('task.progressEmpty')}</li>
				{/if}
			</ol>
		{/if}
		{#if selected.status === 'failed'}
			<p class="task-card__error">{t('task.failed')}</p>
		{/if}
		{#if selected.cards && selected.cards.length > 0}
			<ResultCards cards={selected.cards} compact />
		{/if}
		<div class="task-card__actions">
			{#if selected.status === 'queued' || selected.status === 'running'}
				<button type="button" class="btn btn--ghost" onclick={() => onCancel(selected.id)}
					>{t('task.cancel')}</button
				>
			{:else}
				<button
					type="button"
					class="btn btn--primary"
					onclick={() => {
						selectedId = null;
						onSpeak();
					}}>{t('task.readIt')}</button
				>
			{/if}
		</div>
	</section>
{/if}

<style>
	.orbit {
		position: absolute;
		z-index: 4;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
	}

	.sat {
		position: absolute;
		left: -22px;
		top: -22px;
		width: 44px;
		height: 44px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: translate 0.4s ease;
	}

	.sat__core {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		box-sizing: border-box;
		border: 2px solid #6f9ca0;
		background: #0b2a2e;
	}

	.sat--running .sat__core {
		border: 3px solid #5ee7ff;
		box-shadow: 0 0 14px rgba(94, 231, 255, 0.6);
		animation: sat-pulse 1.4s ease-in-out infinite;
	}

	.sat--done .sat__core {
		border: none;
		background: #cafdff;
		box-shadow:
			0 0 0 6px rgba(202, 253, 255, 0.14),
			0 0 18px rgba(202, 253, 255, 0.7);
	}

	.sat--failed .sat__core {
		border: 2px solid #f08a7e;
		background: #3a1714;
	}

	.sat--selected .sat__core {
		outline: 2px solid #e8f7f8;
		outline-offset: 4px;
	}

	.sat:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}

	@keyframes sat-pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.18);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sat--running .sat__core {
			animation: none;
		}
		.sat {
			transition: none;
		}
	}

	.task-card {
		position: absolute;
		z-index: 6;
		left: 50%;
		bottom: calc(9.5rem + env(safe-area-inset-bottom));
		translate: -50% 0;
		width: min(26rem, calc(100vw - 2rem));
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem 1rem 1rem;
		border: 1px solid rgba(142, 184, 188, 0.28);
		border-radius: 1.3rem;
		background: rgba(10, 27, 30, 0.96);
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
		color: #e8f7f8;
		text-align: left;
		max-height: 52dvh;
		overflow-y: auto;
	}

	.task-card__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.task-card__status {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #8eb8bc;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.task-card__status--running {
		color: #5ee7ff;
	}

	.task-card__status--done {
		color: #cafdff;
	}

	.task-card__status--failed {
		color: #f08a7e;
	}

	.task-card__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}

	.task-card__time {
		font-variant-numeric: tabular-nums;
	}

	.task-card__close {
		width: 2.75rem;
		height: 2.75rem;
		margin: -0.5rem -0.5rem -0.5rem 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: #a9d2d6;
		cursor: pointer;
	}

	.task-card__title {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 500;
		line-height: 1.35;
	}

	.task-card__feed {
		margin: 0;
		padding: 0 0 0 0.85rem;
		list-style: none;
		border-left: 1px solid rgba(94, 231, 255, 0.3);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: #8eb8bc;
		font-size: 0.84rem;
	}

	.task-card__feed--current {
		color: #e8f7f8;
	}

	.task-card__error {
		margin: 0;
		color: #f4b3aa;
		font-size: 0.85rem;
	}

	.task-card__actions {
		display: flex;
		justify-content: flex-end;
	}

	.btn {
		min-height: 2.75rem;
		padding: 0 1.2rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.92rem;
		cursor: pointer;
	}

	.btn--ghost {
		border: 1px solid rgba(142, 184, 188, 0.4);
		background: transparent;
		color: #e8f7f8;
	}

	.btn--primary {
		border: none;
		background: #cafdff;
		color: #062023;
		font-weight: 500;
	}

	.btn:focus-visible,
	.task-card__close:focus-visible {
		outline: 2px solid #5ee7ff;
		outline-offset: 2px;
	}
</style>
