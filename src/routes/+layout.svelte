<script lang="ts">
	import { browser } from '$app/environment';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { getLocale, syncLocale, t } from '$lib/i18n';

	let { data, children } = $props();

	$effect.pre(() => {
		syncLocale(data.locale);
	});

	const title = $derived(t('meta.title', browser ? getLocale() : data.locale));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{title}</title>
</svelte:head>

{@render children()}
