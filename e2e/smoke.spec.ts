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
