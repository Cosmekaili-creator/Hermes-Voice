import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA, type VoicePersona } from '$lib/persona/types';
import { resolveSessionConfig } from './active.server';

const ENV_KEYS = ['VOICE_PROVIDER', 'XAI_VOICE', 'OPENAI_VOICE', 'OPENAI_REALTIME_MODEL'] as const;

function persona(overrides: Partial<VoicePersona> = {}): VoicePersona {
	return { ...DEFAULT_PERSONA, ...overrides };
}

describe('resolveSessionConfig voice precedence', () => {
	afterEach(() => {
		for (const key of ENV_KEYS) delete process.env[key];
	});

	it('falls back to caps.defaultVoice when nothing is set (xAI)', () => {
		const config = resolveSessionConfig(persona());
		expect(config.provider).toBe('xai');
		expect(config.voice).toBe('eve');
	});

	it('an env override wins over the provider default when persona.voiceId is null', () => {
		process.env.XAI_VOICE = 'nova';
		const config = resolveSessionConfig(persona());
		expect(config.voice).toBe('nova');
	});

	it('persona.voiceId wins over the env override', () => {
		process.env.XAI_VOICE = 'nova';
		const config = resolveSessionConfig(persona({ voiceId: 'from-persona' }));
		expect(config.voice).toBe('from-persona');
	});

	it('an invalid persona.voiceId falls back to caps.defaultVoice rather than propagating raw', () => {
		// Bypasses normalizePersona (e.g. a hand-edited bindings.json row) — must be
		// re-validated by resolveSessionConfig itself, not trusted.
		const config = resolveSessionConfig(persona({ voiceId: 'not valid!! \n' }));
		expect(config.voice).toBe('eve');
	});

	it('an invalid persona.voiceId does not fall through to a present env override either', () => {
		process.env.XAI_VOICE = 'nova';
		const config = resolveSessionConfig(persona({ voiceId: 'BAD VALUE' }));
		// Invalid persona.voiceId is normalized away entirely — falls straight to
		// caps.defaultVoice, per the stated precedence (persona wins outright, it does
		// not "skip down" to the env tier on failure).
		expect(config.voice).toBe('eve');
	});

	it('resolves the OpenAI provider default voice/model when VOICE_PROVIDER=openai', () => {
		process.env.VOICE_PROVIDER = 'openai';
		const config = resolveSessionConfig(persona());
		expect(config.provider).toBe('openai');
		expect(config.voice).toBe('alloy');
	});

	it('OPENAI_VOICE env override applies under the openai provider', () => {
		process.env.VOICE_PROVIDER = 'openai';
		process.env.OPENAI_VOICE = 'marin';
		const config = resolveSessionConfig(persona());
		expect(config.voice).toBe('marin');
	});

	it('persona.voiceId wins over OPENAI_VOICE too', () => {
		process.env.VOICE_PROVIDER = 'openai';
		process.env.OPENAI_VOICE = 'marin';
		const config = resolveSessionConfig(persona({ voiceId: 'cedar' }));
		expect(config.voice).toBe('cedar');
	});
});
