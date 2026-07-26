import { error, isHttpError, type RequestHandler } from '@sveltejs/kit';
import { requireVoiceKey } from '$lib/server/auth';
import { MAX_HERMES_REQUEST_CHARS, streamHermesChat } from '$lib/server/hermes';
import { assertSameOrigin } from '$lib/server/origin.server';
import { enforceRateLimit, RATE } from '$lib/server/rateLimit.server';

/**
 * Hermes bridge — SSE to the Lounge:
 *   event: tool  → { tool, label?, status? }
 *   event: done  → { text }
 *   event: error → { message, status? }
 */
export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	const body = await event.request.json().catch(() => ({}));
	const binding = await requireVoiceKey(event, body);
	enforceRateLimit(event, 'hermes', RATE.hermes.limit, RATE.hermes.windowMs, binding.id);

	const request =
		body && typeof body === 'object' && 'request' in body
			? String((body as { request?: unknown }).request ?? '').trim()
			: '';
	if (!request) {
		error(400, 'Missing request');
	}
	if (request.length > MAX_HERMES_REQUEST_CHARS) {
		error(400, 'Request too large');
	}

	const sessionId =
		body && typeof body === 'object' && 'session_id' in body
			? String((body as { session_id?: unknown }).session_id ?? '').trim() || undefined
			: undefined;

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (name: string, data: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
			};
			try {
				const { text } = await streamHermesChat({
					request,
					sessionId,
					signal: event.request.signal,
					hermesApiBase: binding.hermesApiBase,
					hermesApiKey: binding.hermesApiKey,
					hermesSessionKey: binding.hermesSessionKey,
					onToolProgress: (progress) => {
						send('tool', {
							tool: progress.tool,
							label: progress.label,
							status: progress.status
						});
					}
				});
				send('done', { text });
			} catch (err) {
				if (event.request.signal.aborted) {
					send('error', { message: 'Cancelled', status: 499 });
				} else if (isHttpError(err)) {
					const bodyMsg =
						typeof err.body === 'object' &&
						err.body &&
						'message' in err.body &&
						typeof (err.body as { message?: unknown }).message === 'string'
							? (err.body as { message: string }).message
							: 'Hermes request failed';
					send('error', { message: bodyMsg, status: err.status });
				} else {
					send('error', { message: 'Hermes request failed', status: 502 });
				}
			} finally {
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
