import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module keeps a single-slot, module-level cache — reset the module (via
// vi.resetModules + a fresh dynamic import) before every test so cache state from one
// test can never leak into the next.
let fetchXaiVoices: typeof import('./voices.server').fetchXaiVoices;
let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body)
	} as Response;
}

beforeEach(async () => {
	vi.resetModules();
	delete process.env.XAI_API_KEY;
	fetchMock = vi.fn();
	global.fetch = fetchMock as unknown as typeof fetch;
	({ fetchXaiVoices } = await import('./voices.server'));
});

afterEach(() => {
	global.fetch = originalFetch;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('fetchXaiVoices', () => {
	it('returns missing_key with no api key available anywhere, without calling fetch', async () => {
		const result = await fetchXaiVoices();
		expect(result).toEqual({ ok: false, code: 'missing_key' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('parses a well-formed payload and drops malformed rows without throwing', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				voices: [
					{ voice_id: 'eve', name: 'Eve', language: 'en' },
					{ voice_id: '   ', name: 'blank id dropped' },
					{ name: 'no voice_id at all' },
					'not-an-object',
					42,
					{ voice_id: 'nova' }
				]
			})
		);

		const result = await fetchXaiVoices('key-a');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.voices).toEqual([
				{ id: 'eve', name: 'Eve', language: 'en' },
				{ id: 'nova', name: 'nova', language: undefined }
			]);
		}
	});

	it('a malformed top-level payload (no voices array) yields an empty list, not a throw', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ not_voices: [] }));
		const result = await fetchXaiVoices('key-a');
		expect(result).toEqual({ ok: true, voices: [] });
	});

	it('a second call within the TTL for the same key makes no network call (cache hit)', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'eve', name: 'Eve' }] }));

		const first = await fetchXaiVoices('key-a');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const second = await fetchXaiVoices('key-a');
		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a different key fingerprint busts the cache and re-fetches', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'eve', name: 'Eve' }] }));
		await fetchXaiVoices('key-a');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockResolvedValueOnce(
			jsonResponse({ voices: [{ voice_id: 'other', name: 'Other' }] })
		);
		const result = await fetchXaiVoices('key-b');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.voices).toEqual([{ id: 'other', name: 'Other', language: undefined }]);
	});

	it('TTL expiry triggers a re-fetch for the same key', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'v1', name: 'V1' }] }));
		await fetchXaiVoices('key-c');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(10 * 60_000 + 1);

		fetchMock.mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'v2', name: 'V2' }] }));
		const result = await fetchXaiVoices('key-c');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.voices).toEqual([{ id: 'v2', name: 'V2', language: undefined }]);
	});

	it('returns fetch_upstream on a non-200 response without throwing', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 401));
		const result = await fetchXaiVoices('key-d');
		expect(result).toEqual({ ok: false, code: 'fetch_upstream' });
	});

	it('returns fetch_failed on a non-JSON body without throwing', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			text: async () => 'not json'
		} as Response);
		const result = await fetchXaiVoices('key-e');
		expect(result).toEqual({ ok: false, code: 'fetch_failed' });
	});

	it('returns fetch_failed when the network request itself throws (no throw escapes)', async () => {
		fetchMock.mockRejectedValueOnce(new Error('network down'));
		const result = await fetchXaiVoices('key-f');
		expect(result).toEqual({ ok: false, code: 'fetch_failed' });
	});

	it('never logs the raw API key, even on an upstream error that echoes it back', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const secretKey = 'xai-super-secret-key-value';
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => `Authorization Bearer ${secretKey} was rejected`
		} as Response);

		const result = await fetchXaiVoices(secretKey);
		expect(result).toEqual({ ok: false, code: 'fetch_upstream' });

		for (const call of errSpy.mock.calls) {
			expect(call.join(' ')).not.toContain(secretKey);
		}
	});
});
