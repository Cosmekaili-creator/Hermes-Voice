import { VOICE_TOOLS } from '$lib/voice/tools';
import { PCM_RATE } from '../pcm';
import type {
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeServerEvent,
	WireTurnDetection
} from '../types';
import { DEFAULT_MODEL, DEFAULT_VOICE, realtimeUrl } from './constants';

export type {
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeServerEvent,
	WireTurnDetection
};

/** Map legacy / alias event names onto the GA names voiceSession switches on. */
function normalizeServerEvent(event: RealtimeServerEvent): RealtimeServerEvent {
	const type = event.type;
	if (type === 'response.audio.delta') {
		return { ...event, type: 'response.output_audio.delta' };
	}
	if (type === 'response.audio_transcript.delta') {
		return { ...event, type: 'response.output_audio_transcript.delta' };
	}
	if (type === 'response.audio.done') {
		return { ...event, type: 'response.output_audio.done' };
	}
	return event;
}

/**
 * Browser WebSocket client for OpenAI Realtime (GA).
 * Auth via subprotocols `realtime` + `openai-insecure-api-key.<ephemeral>`.
 * session.update uses nested audio.input.turn_detection / audio.output.voice.
 *
 * Caches last instructions + turn_detection so locale refresh / partial updates
 * never reset VAD back to null.
 */
export function createRealtimeClient(
	handlers: RealtimeClientHandlers = {},
	options: RealtimeClientOptions = {}
): RealtimeClient {
	let ws: WebSocket | null = null;
	let ready = false;
	let connectGeneration = 0;
	let cachedInstructions = '';
	let cachedTurnDetection: WireTurnDetection = null;
	const model = options.model?.trim() || DEFAULT_MODEL;
	const voice = options.voice?.trim() || DEFAULT_VOICE;

	function sessionUpdatePayload() {
		return {
			type: 'session.update',
			session: {
				type: 'realtime',
				model,
				instructions: cachedInstructions,
				output_modalities: ['audio'],
				tools: [...VOICE_TOOLS],
				audio: {
					input: {
						format: { type: 'audio/pcm', rate: PCM_RATE },
						turn_detection: cachedTurnDetection
					},
					output: {
						format: { type: 'audio/pcm', rate: PCM_RATE },
						voice
					}
				}
			}
		};
	}

	function send(obj: Record<string, unknown>) {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(obj));
	}

	function close() {
		ready = false;
		const sock = ws;
		ws = null;
		if (sock) {
			try {
				sock.onopen = null;
				sock.onmessage = null;
				sock.onerror = null;
				sock.onclose = null;
				if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
					sock.close();
				}
			} catch {
				/* ignore */
			}
		}
	}

	function updateInstructions(instructions: string) {
		cachedInstructions = instructions;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		send(sessionUpdatePayload());
	}

	function setTurnDetection(turnDetection: WireTurnDetection) {
		cachedTurnDetection = turnDetection;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		send(sessionUpdatePayload());
	}

	async function connect(
		token: string,
		instructions: string,
		turnDetection: WireTurnDetection = null
	): Promise<void> {
		close();
		const gen = ++connectGeneration;
		ready = false;
		cachedInstructions = instructions;
		cachedTurnDetection = turnDetection;

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const fail = (message: string) => {
				if (settled || gen !== connectGeneration) return;
				settled = true;
				ready = false;
				close();
				reject(new Error(message));
			};

			let sock: WebSocket;
			try {
				sock = new WebSocket(realtimeUrl(model), ['realtime', `openai-insecure-api-key.${token}`]);
			} catch (err) {
				reject(err instanceof Error ? err : new Error('websocketFailed'));
				return;
			}
			ws = sock;

			const timeout = setTimeout(() => {
				fail('sessionConnectTimeout');
			}, 20000);

			sock.onopen = () => {
				if (gen !== connectGeneration) return;
				handlers.onOpen?.();
				send(sessionUpdatePayload());
			};

			sock.onmessage = (ev) => {
				if (gen !== connectGeneration) return;
				let event: RealtimeServerEvent;
				try {
					event = JSON.parse(String(ev.data)) as RealtimeServerEvent;
				} catch {
					return;
				}

				const normalized = normalizeServerEvent(event);
				handlers.onEvent?.(normalized);

				if (normalized.type === 'session.updated') {
					ready = true;
					if (!settled) {
						settled = true;
						clearTimeout(timeout);
						resolve();
					}
					return;
				}

				if (normalized.type === 'error') {
					const msg =
						(typeof normalized.error?.message === 'string' && normalized.error.message) ||
						'realtimeSessionError';
					handlers.onError?.(msg);
					if (!settled) {
						fail(msg);
					}
				}
			};

			sock.onerror = () => {
				handlers.onError?.('websocketError');
				if (!settled) fail('websocketError');
			};

			sock.onclose = (closeEv) => {
				clearTimeout(timeout);
				ready = false;
				if (ws === sock) ws = null;
				handlers.onClose?.(closeEv);
				if (!settled) {
					fail(closeEv.reason || 'websocketClosed');
				}
			};
		});
	}

	return {
		get ready() {
			return ready;
		},
		get open() {
			return !!ws && ws.readyState === WebSocket.OPEN;
		},
		connect,
		updateInstructions,
		setTurnDetection,
		send,
		appendAudio(base64Pcm16: string) {
			if (!ready) return;
			send({ type: 'input_audio_buffer.append', audio: base64Pcm16 });
		},
		commitAndRespond() {
			send({ type: 'input_audio_buffer.commit' });
			send({ type: 'response.create' });
		},
		cancelResponse() {
			send({ type: 'response.cancel' });
		},
		clearInputBuffer() {
			send({ type: 'input_audio_buffer.clear' });
		},
		sendFunctionCallOutput(callId: string, output: string) {
			send({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: callId,
					output
				}
			});
		},
		respond() {
			send({ type: 'response.create' });
		},
		close
	};
}
