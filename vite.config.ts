import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node output dir (systemd / process expects build/index.js)
			adapter: adapter({ out: 'build' }),

			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// unsafe-inline: SvelteKit injects critical CSS; avoid hashing churn for now (C-L3).
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'media-src': ['self', 'blob:'],
					'font-src': ['self'],
					'connect-src': [
						'self',
						'https://api.x.ai',
						'wss://api.x.ai',
						'https://api.openai.com',
						'wss://api.openai.com'
					],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none'],
					'upgrade-insecure-requests': true
				}
			}
		})
	]
});
