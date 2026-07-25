/** Server facade — deep-imports mint (never via client-safe barrels). */
export { mintRealtimeClientSecret, probeMint } from '$lib/providers/openai/mint.server';
export type { EphemeralClientSecret } from '$lib/providers/types';
export type { MintProbeCode, MintProbeResult } from '$lib/providers/openai/mint.server';
