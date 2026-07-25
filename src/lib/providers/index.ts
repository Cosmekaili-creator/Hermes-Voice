import { CAPABILITY_MATRIX } from './matrix';
import type { ProviderCapabilities, ProviderId } from './types';

/** Active voice provider — hardcoded until multi-provider selection exists. */
export function getActiveProvider(): ProviderId {
	return 'xai';
}

export function getActiveCapabilities(): ProviderCapabilities {
	return CAPABILITY_MATRIX[getActiveProvider()];
}

export type {
	EphemeralClientSecret,
	ProviderCapabilities,
	ProviderId,
	VoiceInfo,
	WireTurnDetection
} from './types';
export { CAPABILITY_MATRIX } from './matrix';
