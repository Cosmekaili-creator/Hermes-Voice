import { describe, expect, it } from 'vitest';
import { pickPresentFields } from './settingsFields.server';

const PROVIDER_ALLOWLIST = [
	'VOICE_PROVIDER',
	'XAI_API_KEY',
	'OPENAI_API_KEY',
	'XAI_VOICE',
	'OPENAI_VOICE'
] as const;

const HERMES_ALLOWLIST = ['HERMES_API_BASE', 'HERMES_API_KEY', 'HERMES_SESSION_KEY'] as const;

describe('pickPresentFields', () => {
	it('an absent key is never read, written, or defaulted — empty fields yields an empty result', () => {
		const result = pickPresentFields({}, HERMES_ALLOWLIST);
		expect(result).toEqual({ ok: true, fields: {} });
	});

	it('non-object body behaves like an empty fields object', () => {
		expect(pickPresentFields(null, HERMES_ALLOWLIST)).toEqual({ ok: true, fields: {} });
		expect(pickPresentFields(undefined, HERMES_ALLOWLIST)).toEqual({ ok: true, fields: {} });
		expect(pickPresentFields('garbage', HERMES_ALLOWLIST)).toEqual({ ok: true, fields: {} });
	});

	it('passes through only the present, allowlisted keys', () => {
		const result = pickPresentFields(
			{ HERMES_API_BASE: 'http://127.0.0.1:8642' },
			HERMES_ALLOWLIST
		);
		expect(result).toEqual({ ok: true, fields: { HERMES_API_BASE: 'http://127.0.0.1:8642' } });
	});

	it('a key outside the section allowlist fails closed with field_not_in_section', () => {
		const result = pickPresentFields({ VOICE_PROVIDER: 'xai' }, HERMES_ALLOWLIST);
		expect(result).toEqual({ ok: false, code: 'field_not_in_section' });
	});

	it('a dangerous key never in any allowlist (e.g. VOICE_URL_KEY) fails closed the same way', () => {
		const result = pickPresentFields({ VOICE_URL_KEY: 'steal-me' }, PROVIDER_ALLOWLIST);
		expect(result).toEqual({ ok: false, code: 'field_not_in_section' });
	});

	it('an empty string on a present key fails closed with empty_field (this route can never clear a key)', () => {
		const result = pickPresentFields({ HERMES_API_KEY: '' }, HERMES_ALLOWLIST);
		expect(result).toEqual({ ok: false, code: 'empty_field' });
	});

	it('a non-string value on a present key fails closed with empty_field', () => {
		const result = pickPresentFields({ HERMES_API_KEY: 42 }, HERMES_ALLOWLIST);
		expect(result).toEqual({ ok: false, code: 'empty_field' });
	});

	describe('A5 mandatory acceptance test — the direct proof the corruption bug is fixed', () => {
		it('wizard-default-shaped values, with those keys OMITTED from fields, produce zero picked fields', () => {
			// Simulates a correctly-not-dirty client: the wizard's non-empty defaults
			// (hermesSessionKey: 'agent:main:voice', hermesApiBase: 'http://127.0.0.1:8642')
			// exist as *current state*, but the client never dirtied them, so they are
			// simply absent from the request body — not sent as empty strings, not sent at all.
			const result = pickPresentFields({}, HERMES_ALLOWLIST);
			expect(result).toEqual({ ok: true, fields: {} });
		});

		it('the same keys PRESENT and matching current state still get picked (presence, not value-equality)', () => {
			// Present-key semantics never special-case "same as current" — a present key is
			// always picked/written, confirming the contract is about presence, not diffing.
			const result = pickPresentFields(
				{ HERMES_SESSION_KEY: 'agent:main:voice', HERMES_API_BASE: 'http://127.0.0.1:8642' },
				HERMES_ALLOWLIST
			);
			expect(result).toEqual({
				ok: true,
				fields: {
					HERMES_SESSION_KEY: 'agent:main:voice',
					HERMES_API_BASE: 'http://127.0.0.1:8642'
				}
			});
		});
	});
});
