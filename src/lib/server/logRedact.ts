/**
 * Redact secrets / token-like substrings before writing to console.
 * Never log raw audio (Voice does not put audio on the Node path).
 */
export function redactForLog(input: string, max = 200): string {
	let s = input;

	// Authorization headers / Bearer tokens
	s = s.replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]');

	// URL / form / JSON voice key
	s = s.replace(/([?&]k=)[^&\s"']+/gi, '$1[REDACTED]');
	s = s.replace(/("k"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
	s = s.replace(/('k'\s*:\s*')[^']*(')/gi, '$1[REDACTED]$2');

	// Common secret / ephemeral shapes (xAI client secrets, sk- keys, long opaque blobs)
	s = s.replace(/xai-client-secret\.[A-Za-z0-9._\-]+/gi, 'xai-client-secret.[REDACTED]');
	s = s.replace(/\bsk-[A-Za-z0-9]{8,}\b/g, 'sk-[REDACTED]');
	s = s.replace(/("(?:value|api_key|token|secret|password)"\s*:\s*")[^"]{8,}(")/gi, '$1[REDACTED]$2');

	// Long base64-ish runs (audio / tokens) — keep short fragments for debug
	s = s.replace(/[A-Za-z0-9+/]{48,}={0,2}/g, '[REDACTED_B64]');

	if (s.length > max) {
		s = `${s.slice(0, max)}…`;
	}
	return s;
}
