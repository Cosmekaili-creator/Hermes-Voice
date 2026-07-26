import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [voiceSession, lounge] = await Promise.all([
	readFile(new URL('../src/lib/voice/voiceSession.svelte.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/lib/components/LazicLounge.svelte', import.meta.url), 'utf8')
]);

assert.match(
	voiceSession,
	/VOICE_SESSION_STORAGE_KEY/,
	'voice session ID must have a sessionStorage key so it survives an iOS same-tab reload'
);
assert.match(
	voiceSession,
	/sessionStorage\.getItem\(VOICE_SESSION_STORAGE_KEY\)/,
	'voice session ID must restore from sessionStorage'
);
assert.match(
	voiceSession,
	/sessionStorage\.setItem\(VOICE_SESSION_STORAGE_KEY, id\)/,
	'new voice session ID must be persisted to sessionStorage'
);
assert.match(
	voiceSession,
	/suspendForBackground/,
	'voice session must expose a background-suspend lifecycle operation'
);
assert.match(
	voiceSession,
	/recoverConnection/,
	'voice session must expose a foreground/network recovery operation'
);
assert.match(
	lounge,
	/document\.addEventListener\('visibilitychange', onVisibilityChange\)/,
	'Lounge must suspend/recover when Safari visibility changes'
);
assert.match(
	lounge,
	/window\.addEventListener\('pageshow', onPageShow\)/,
	'Lounge must recover when iOS restores a frozen/bfcache page'
);
assert.match(
	lounge,
	/window\.addEventListener\('online', onOnline\)/,
	'Lounge must recover after a network return'
);
assert.match(
	lounge,
	/document\.removeEventListener\('visibilitychange', onVisibilityChange\)/,
	'Lounge must clean up its visibility listener'
);
assert.match(
	lounge,
	/window\.removeEventListener\('pageshow', onPageShow\)/,
	'Lounge must clean up its pageshow listener'
);
assert.match(
	lounge,
	/window\.removeEventListener\('online', onOnline\)/,
	'Lounge must clean up its online listener'
);

console.log('voice lifecycle recovery contract: ok');
