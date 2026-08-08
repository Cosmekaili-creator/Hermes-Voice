<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import LazicLounge from '$lib/components/LazicLounge.svelte';
	import LockedGate from '$lib/components/LockedGate.svelte';

	let { data } = $props();

	// Cosmetic only: hide ?k= from the address bar without a navigation that can drop PWA cookies.
	$effect(() => {
		if (!data.unlocked) return;
		if (!page.url.searchParams.has('k')) return;
		const clean = new URL(page.url);
		clean.searchParams.delete('k');
		const path = clean.pathname + clean.search + clean.hash;
		replaceState(path, {});
	});
</script>

{#if data.unlocked}
	<LazicLounge persona={data.persona} provider={data.provider} isOwner={data.isOwner} />
{:else}
	<LockedGate setupMode={data.setupMode} />
{/if}
