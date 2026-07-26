/** Truncate Hermes wait / caption display text for Lounge chrome. */
export const HERMES_WAIT_SNIPPET_CHARS = 64;

export function truncateSnippet(text: string, maxChars = HERMES_WAIT_SNIPPET_CHARS): string {
	const cleaned = text.replace(/\s+/g, ' ').trim();
	if (cleaned.length <= maxChars) return cleaned;
	if (maxChars <= 1) return '…';
	return `${cleaned.slice(0, maxChars - 1)}…`;
}

/** Prefer Hermes preview label; fall back to tool id. */
export function formatHermesToolActivity(tool: string, label?: string): string {
	const fromLabel = label?.replace(/\s+/g, ' ').trim();
	if (fromLabel) return truncateSnippet(fromLabel, 48);
	return truncateSnippet(tool.replace(/_/g, ' '), 48);
}
