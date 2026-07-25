import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Length-oracle-resistant string compare: hash both sides to fixed-size digests
 * then timingSafeEqual. Not a MAC of a secret — only equal/unequal.
 */
export function safeEqualStr(a: string, b: string): boolean {
	const ha = createHash('sha256').update(a, 'utf8').digest();
	const hb = createHash('sha256').update(b, 'utf8').digest();
	return timingSafeEqual(ha, hb);
}
