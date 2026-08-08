/**
 * Present-key-only field extraction for `POST /api/settings/save`. Pulled out as a pure
 * function (mirrors `mergePersonaPatch` in `persona/types.ts`) specifically so it has
 * direct unit-test coverage — this repo has no route-level test harness, so this
 * extraction *is* the regression coverage for the settings-save route's core safety
 * contract: a key absent from the request body is never read, written, or defaulted to
 * anything. See `src/routes/api/settings/save/+server.ts`.
 */

export type PickPresentFieldsResult =
	| { ok: true; fields: Record<string, string> }
	| { ok: false; code: 'field_not_in_section' | 'empty_field' };

/**
 * Only the keys actually present (own-enumerable-property) on `fieldsBody` are
 * considered. Any present key outside `allowlist` fails closed with
 * `field_not_in_section`. Any present key whose value is an empty string or not a
 * string at all fails closed with `empty_field` — this route can never clear a
 * managed key (clearing stays a `/setup`/hand-edit operation).
 */
export function pickPresentFields(
	fieldsBody: unknown,
	allowlist: readonly string[]
): PickPresentFieldsResult {
	const o =
		fieldsBody && typeof fieldsBody === 'object' ? (fieldsBody as Record<string, unknown>) : {};
	const fields: Record<string, string> = {};

	for (const key of Object.keys(o)) {
		if (!allowlist.includes(key)) {
			return { ok: false, code: 'field_not_in_section' };
		}
		const value = o[key];
		if (typeof value !== 'string' || value === '') {
			return { ok: false, code: 'empty_field' };
		}
		fields[key] = value;
	}

	return { ok: true, fields };
}
