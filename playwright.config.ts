import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Smoke suite only — no xAI/OpenAI provider keys are set. Locked-gate + auth
 * failure paths must work with just VOICE_URL_KEY configured.
 */
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',
	timeout: 30_000,
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry'
	},
	webServer: {
		command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		env: {
			HOST: '127.0.0.1',
			PORT: String(PORT),
			ORIGIN: BASE_URL,
			VOICE_URL_KEY: 'ci-test-key'
		}
	}
});
