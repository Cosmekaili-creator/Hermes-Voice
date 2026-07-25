import { VOICE_TOOLS } from '$lib/voice/tools';
import type { WireTurnDetection } from '../types';
import { DEFAULT_MODEL, DEFAULT_VOICE, PCM_RATE, REALTIME_URL } from './constants';

export type { WireTurnDetection };

export type RealtimeServerEvent = {
	type: string;
	delta?: string;
	name?: string;
	call_id?: string;
	arguments?: string;
	error?: { message?: string; type?: string; code?: string };
	[key: string]: unknown;
};

export type RealtimeClientHandlers = {
	onEvent?: (event: RealtimeServerEvent) => void;
	onOpen?: () => void;
	onClose?: (ev: CloseEvent) => void;
	onError?: (message: string) => void;
};

export type RealtimeClient = {
	readonly ready: boolean;
	readonly open: boolean;
	connect(token: string, instructions: string, turnDetection?: WireTurnDetection): Promise<void>;
	updateInstructions(instructions: string): void;
	setTurnDetection(turnDetection: WireTurnDetection): void;
	send(obj: Record<string, unknown>): void;
	appendAudio(base64Pcm16: string): void;
	commitAndRespond(): void;
	cancelResponse(): void;
	clearInputBuffer(): void;
	sendFunctionCallOutput(callId: string, output: string): void;
	respond(): void;
	close(): void;
};

/**
 * Browser WebSocket client for xAI realtime.
 * Auth via subprotocol `xai-client-secret.<ephemeral>` (browsers cannot set Authorization).
 * Waits for `session.updated` before resolving connect (append only after ready).
 *
 * Caches last instructions + turn_detection so locale refresh / partial updates
 * never reset VAD back to null.
 */
export function createRealtimeClient(handlers: RealtimeClientHandlers = {}): RealtimeClient {
	let ws: WebSocket | null = null;
	let ready = false;
	let connectGeneration = 0;
	let cachedInstructions = '';
	let cachedTurnDetection: WireTurnDetection = null;

	function sessionUpdatePayload() {
		return {
			type: 'session.update',
			session: {
				model: DEFAULT_MODEL,
				voice: DEFAULT_VOICE,
				instructions: cachedInstructions,
				turn_detection: cachedTurnDetection,
				tools: [...VOICE_TOOLS],
				audio: {
					input: { format: { type: 'audio/pcm', rate: PCM_RATE } },
					output: { format: { type: 'audio/pcm', rate: PCM_RATE } }
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
				sock = new WebSocket(REALTIME_URL, [`xai-client-secret.${token}`]);
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

				handlers.onEvent?.(event);

				if (event.type === 'session.updated') {
					ready = true;
					if (!settled) {
						settled = true;
						clearTimeout(timeout);
						resolve();
					}
					return;
				}

				if (event.type === 'error') {
					const msg =
						(typeof event.error?.message === 'string' && event.error.message) ||
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
