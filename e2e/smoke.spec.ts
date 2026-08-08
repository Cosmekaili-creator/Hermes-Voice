import { expect, test } from '@playwright/test';

/**
 * Smoke suite — runs against a preview server with VOICE_URL_KEY and
 * SETUP_COMPLETE=1 set (no xAI/OpenAI provider keys, no ALLOW_SELF_RESTART).
 * Covers health, the locked gate UI, the same-origin auth failure path, CSP
 * presence, and (chunk A) the settings pill/gear + modal.
 */

test('GET /health returns 200 + ok', async ({ request }) => {
	const res = await request.get('/health');
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.ok).toBe(true);
});

test('GET / renders the locked gate when unauthenticated', async ({ page, baseURL }) => {
	const res = await page.goto(baseURL!);
	expect(res?.status()).toBe(200);
	await expect(page.locator('.gate')).toBeVisible();
	await expect(page.getByText('Access Restricted')).toBeVisible();
});

test('POST /api/session with same-origin Origin but no key returns 401', async ({
	request,
	baseURL
}) => {
	const res = await request.post('/api/session', {
		headers: { Origin: baseURL! },
		data: {}
	});
	expect(res.status()).toBe(401);
});

test('GET / sends a content-security-policy header', async ({ request, baseURL }) => {
	const res = await request.get(baseURL!);
	expect(res.headers()['content-security-policy']).toBeTruthy();
});

// A12 guard: SETUP_COMPLETE=1 in the e2e env (playwright.config.ts) moves this suite
// from `ops_locked` to `complete` mode — confirm /setup can't silently be left wide
// open to anonymous bootstrap by that change. Unauthenticated + complete must show the
// "already configured, sign in to rotate" copy, never the bootstrap unlock/wizard form.
test('GET /setup unauthenticated shows the complete-locked state, not the bootstrap form', async ({
	page
}) => {
	await page.goto('/setup');
	await expect(page.getByText('Setup complete')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open Lounge' })).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveCount(0);
});

test.describe('lounge', () => {
	// warm() fires /api/session, which 500s here (no provider key) — the Lounge must
	// still render. Do not assert on status text; it depends on mint timing.

	test('renders the talk button, primer, composer, and the provider pill even when mint fails', async ({
		page
	}) => {
		await page.goto('/?k=ci-test-key');

		const talk = page.locator('.talk');
		await expect(talk).toBeVisible();
		await expect(talk).toHaveText(/Press to talk/);

		// Item 2: mic primer shown once per fresh browser context.
		const primer = page.locator('.primer');
		await expect(primer).toBeVisible();
		await page.getByRole('button', { name: 'Got it' }).click();
		await expect(primer).toBeHidden();

		// Item 4: composer is enabled at idle; send is disabled with an empty draft.
		const input = page.locator('.composer__input');
		await expect(input).toBeVisible();
		await expect(input).toBeEnabled();
		await expect(page.locator('.composer__send')).toBeDisabled();

		// Chunk A8: the pill now renders unconditionally (SSR `provider` prop), not gated
		// on a successful mint — this is precisely the case it exists for: a broken/absent
		// provider key is exactly when settings are most needed. The e2e synthetic
		// single-user binding (?k=ci-test-key) has role: 'owner', so it renders as a button.
		const pill = page.locator('.provider-badge');
		await expect(pill).toBeVisible();
		await expect(pill).toHaveText(/xAI/);

		// And the gear beside it (owner-only settings entry point for the Hermes section).
		await expect(page.locator('.settings-gear')).toBeVisible();

		// Item 3: captions don't add idle chrome.
		await expect(page.locator('.captions')).toHaveCount(0);

		// Item 8: touch target bump (1.8rem at a 16px root ⇒ >= 28px).
		const minHeight = await page
			.locator('.talk-mode__btn')
			.first()
			.evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
		expect(minHeight).toBeGreaterThanOrEqual(28);
	});

	test('mic primer does not reappear after dismissal in the same context', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.getByRole('button', { name: 'Got it' }).click();
		await expect(page.locator('.primer')).toBeHidden();

		await page.reload();
		await expect(page.locator('.primer')).toBeHidden();
	});
});

test.describe('settings modal (chunk A)', () => {
	// ?k=ci-test-key is a single-user synthetic binding, always role: 'owner' — the pill
	// and gear render as buttons for it (see the "renders ... even when mint fails" test
	// above for the non-owner-vs-owner rendering distinction).

	test('clicking the pill opens the modal on the provider section', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.locator('.provider-badge').click();
		const dialog = page.locator('dialog.settings-modal');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('heading', { name: 'Voice provider' })).toBeVisible();
	});

	test('clicking the gear opens the modal on the Hermes section', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.locator('.settings-gear').click();
		const dialog = page.locator('dialog.settings-modal');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('heading', { name: 'Hermes connection' })).toBeVisible();
	});

	test('the close button dismisses the modal', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.locator('.settings-gear').click();
		const dialog = page.locator('dialog.settings-modal');
		await expect(dialog).toBeVisible();
		await page.getByRole('button', { name: 'Close' }).click();
		await expect(dialog).toBeHidden();
	});

	test('Esc dismisses the modal', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.locator('.provider-badge').click();
		const dialog = page.locator('dialog.settings-modal');
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	// D3/D5: the self-restart action is gated behind ALLOW_SELF_RESTART, which is
	// deliberately absent from MANAGED_ENV_KEYS (can never be set from a browser) and is
	// unset in this e2e env — this must remain true after the restart UI lands too.
	test('no restart action is reachable when ALLOW_SELF_RESTART is unset', async ({ page }) => {
		await page.goto('/?k=ci-test-key');
		await page.locator('.settings-gear').click();
		await expect(page.locator('dialog.settings-modal')).toBeVisible();
		await expect(page.getByRole('button', { name: /restart/i })).toHaveCount(0);
	});
});
