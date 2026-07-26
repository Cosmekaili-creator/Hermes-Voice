import { VOICE_TOOLS } from '$lib/voice/tools';
import type {
	RealtimeClient,
	RealtimeClientHandlers,
	RealtimeClientOptions,
	RealtimeConnectMedia,
	RealtimeServerEvent,
	WireTurnDetection
} from '../types';
import { DEFAULT_MODEL, DEFAULT_VOICE, REALTIME_CALLS_URL } from './constants';

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

function isDataChannelOpen(channel: RTCDataChannel | null): channel is RTCDataChannel {
	return !!channel && channel.readyState === 'open';
}

/**
 * Browser WebRTC client for OpenAI Realtime (GA).
 * Ephemeral token → RTCPeerConnection + `oai-events` data channel → SDP POST `/v1/realtime/calls`.
 * Audio on media tracks; control/tools on the data channel.
 *
 * Caches last instructions + turn_detection so locale refresh / partial updates
 * never reset VAD back to null.
 */
export function createRealtimeClient(
	handlers: RealtimeClientHandlers = {},
	options: RealtimeClientOptions = {}
): RealtimeClient {
	let pc: RTCPeerConnection | null = null;
	let dc: RTCDataChannel | null = null;
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
						turn_detection: cachedTurnDetection
					},
					output: {
						voice
					}
				}
			}
		};
	}

	function send(obj: Record<string, unknown>) {
		if (!isDataChannelOpen(dc)) return;
		dc.send(JSON.stringify(obj));
	}

	function teardownPeer() {
		ready = false;
		const channel = dc;
		const peer = pc;
		dc = null;
		pc = null;

		if (channel) {
			try {
				channel.onopen = null;
				channel.onmessage = null;
				channel.onerror = null;
				channel.onclose = null;
				channel.close();
			} catch {
				/* ignore */
			}
		}
		if (peer) {
			try {
				peer.ontrack = null;
				peer.onconnectionstatechange = null;
				peer.oniceconnectionstatechange = null;
				peer.close();
			} catch {
				/* ignore */
			}
		}
	}

	function close() {
		teardownPeer();
	}

	function updateInstructions(instructions: string) {
		cachedInstructions = instructions;
		if (!isDataChannelOpen(dc)) return;
		send(sessionUpdatePayload());
	}

	function setTurnDetection(turnDetection: WireTurnDetection) {
		cachedTurnDetection = turnDetection;
		if (!isDataChannelOpen(dc)) return;
		send(sessionUpdatePayload());
	}

	function handleMessage(
		raw: string,
		gen: number,
		settled: { value: boolean },
		fail: (m: string) => void,
		resolve: () => void,
		timeout: ReturnType<typeof setTimeout>
	) {
		if (gen !== connectGeneration) return;
		let event: RealtimeServerEvent;
		try {
			event = JSON.parse(raw) as RealtimeServerEvent;
		} catch {
			return;
		}

		const normalized = normalizeServerEvent(event);
		handlers.onEvent?.(normalized);

		if (normalized.type === 'session.updated') {
			ready = true;
			if (!settled.value) {
				settled.value = true;
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
			if (!settled.value) {
				fail(msg);
			}
		}
	}

	async function connect(
		token: string,
		instructions: string,
		turnDetection: WireTurnDetection = null,
		media?: RealtimeConnectMedia
	): Promise<void> {
		close();
		const gen = ++connectGeneration;
		ready = false;
		cachedInstructions = instructions;
		cachedTurnDetection = turnDetection;

		const localStream = media?.localStream;
		if (!localStream) {
			throw new Error('webrtcFailed');
		}

		await new Promise<void>((resolve, reject) => {
			const settled = { value: false };
			const fail = (message: string) => {
				if (settled.value || gen !== connectGeneration) return;
				settled.value = true;
				ready = false;
				teardownPeer();
				reject(new Error(message));
			};

			const timeout = setTimeout(() => {
				fail('sessionConnectTimeout');
			}, 20000);

			let peer: RTCPeerConnection;
			try {
				peer = new RTCPeerConnection();
			} catch {
				clearTimeout(timeout);
				reject(new Error('webrtcFailed'));
				return;
			}
			pc = peer;

			peer.ontrack = (ev) => {
				if (gen !== connectGeneration) return;
				const stream = ev.streams[0] ?? new MediaStream([ev.track]);
				handlers.onRemoteStream?.(stream);
			};

			peer.onconnectionstatechange = () => {
				if (gen !== connectGeneration || !pc) return;
				const state = pc.connectionState;
				if (state === 'failed') {
					handlers.onError?.('webrtcFailed');
					if (!settled.value) fail('webrtcFailed');
					else {
						ready = false;
						handlers.onClose?.(new CloseEvent('close'));
					}
				} else if (state === 'closed' && settled.value) {
					ready = false;
					handlers.onClose?.(new CloseEvent('close'));
				}
			};

			for (const track of localStream.getAudioTracks()) {
				peer.addTrack(track, localStream);
			}

			const channel = peer.createDataChannel('oai-events');
			dc = channel;

			channel.onmessage = (ev) => {
				handleMessage(String(ev.data), gen, settled, fail, resolve, timeout);
			};

			channel.onerror = () => {
				handlers.onError?.('webrtcFailed');
				if (!settled.value) fail('webrtcFailed');
			};

			channel.onclose = () => {
				if (gen !== connectGeneration) return;
				ready = false;
				if (!settled.value) {
					fail('webrtcClosed');
					return;
				}
				handlers.onClose?.(new CloseEvent('close'));
			};

			void (async () => {
				try {
					const offer = await peer.createOffer();
					if (gen !== connectGeneration) return;
					await peer.setLocalDescription(offer);

					const sdp = peer.localDescription?.sdp ?? offer.sdp;
					if (!sdp) {
						fail('sdpExchangeFailed');
						return;
					}

					const sdpResponse = await fetch(REALTIME_CALLS_URL, {
						method: 'POST',
						body: sdp,
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/sdp'
						}
					});

					if (gen !== connectGeneration) return;
					if (!sdpResponse.ok) {
						fail('sdpExchangeFailed');
						return;
					}

					const answerSdp = await sdpResponse.text();
					if (gen !== connectGeneration) return;
					await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });

					handlers.onOpen?.();

					const sendUpdate = () => {
						if (gen !== connectGeneration || !isDataChannelOpen(dc)) return;
						send(sessionUpdatePayload());
					};

					if (channel.readyState === 'open') {
						sendUpdate();
					} else {
						channel.onopen = () => {
							if (gen !== connectGeneration) return;
							sendUpdate();
						};
					}
				} catch {
					if (!settled.value) fail('webrtcFailed');
				}
			})();
		});
	}

	return {
		usesMediaTracks: true,
		supportsBargeIn: true,
		get ready() {
			return ready;
		},
		get open() {
			return isDataChannelOpen(dc) && !!pc && pc.connectionState !== 'closed';
		},
		connect,
		updateInstructions,
		setTurnDetection,
		send,
		appendAudio(_base64Pcm16: string) {
			void _base64Pcm16;
			/* WebRTC mic is the MediaStream track — PCM append unused. */
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
