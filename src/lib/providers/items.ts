/**
 * Realtime conversation item builders — single source of truth for wire shapes
 * shared by the xAI (WebSocket) and OpenAI (WebRTC data channel) clients.
 */

/** User text turn, injected as if spoken. Provider replies with audio + transcript. */
export function userTextItem(text: string): Record<string, unknown> {
	return {
		type: 'message',
		role: 'user',
		content: [{ type: 'input_text', text }]
	};
}
