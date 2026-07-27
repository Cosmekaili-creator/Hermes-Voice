import { expect, test } from '@playwright/test';

/**
 * Smoke suite — runs against a preview server with only VOICE_URL_KEY set
 * (no xAI/OpenAI provider keys). Covers health, the locked gate UI, the
 * same-origin auth failure path, and CSP presence.
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

test.describe('lounge', () => {
	// warm() fires /api/session, which 500s here (no provider key) — the Lounge must
	// still render. Do not assert on status text; it depends on mint timing.

	test('renders the talk button, primer, composer, and no provider badge or captions', async ({
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

		// Item 9: no provider key configured ⇒ mint fails ⇒ badge never renders.
		await expect(page.locator('.provider-badge')).toHaveCount(0);

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
