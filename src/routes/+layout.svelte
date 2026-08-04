<script lang="ts">
	import { browser } from '$app/environment';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { getLocale, setAssistantName, syncLocale, t } from '$lib/i18n';

	let { data, children } = $props();

	$effect.pre(() => {
		syncLocale(data.locale);
		setAssistantName(data.persona.assistantName);
	});

	// Explicit third arg (not the ambient getAssistantName() fallback) — SSR must render the
	// correct persona name on first paint, before setAssistantName()'s browser-only effect runs.
	const title = $derived(
		t('meta.title', browser ? getLocale() : data.locale, data.persona.assistantName)
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{title}</title>
</svelte:head>

{@render children()}
