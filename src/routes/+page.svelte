<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, replaceState } from '$app/navigation';
	import LazicLounge from '$lib/components/LazicLounge.svelte';
	import LockedGate from '$lib/components/LockedGate.svelte';

	let { data } = $props();

	// Cosmetic only: hide ?k= from the address bar without a navigation that can drop PWA cookies.
	// Not a plain $effect: replaceState throws if called before the router has finished
	// starting, and an effect firing during hydration can do exactly that — the throw then
	// aborts the rest of the mount (e.g. the Lounge's onMount never runs). Even the initial
	// afterNavigate fires a moment before SvelteKit marks the router started, so defer one
	// microtask past it.
	afterNavigate(() => {
		queueMicrotask(() => {
			if (!data.unlocked) return;
			if (!page.url.searchParams.has('k')) return;
			const clean = new URL(page.url);
			clean.searchParams.delete('k');
			replaceState(clean.pathname + clean.search + clean.hash, {});
		});
	});
</script>

{#if data.unlocked}
	<LazicLounge
		persona={data.persona}
		provider={data.provider}
		isOwner={data.isOwner}
		asyncTasksEnabled={data.asyncTasksEnabled}
		timelineScope={data.timelineScope}
	/>
{:else}
	<LockedGate setupMode={data.setupMode} />
{/if}
