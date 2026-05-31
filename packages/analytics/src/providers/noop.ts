import type { Provider } from "../types";

/**
 * A provider that drops everything. Used for SSR, tests, when no PostHog key is
 * configured, and as the pre-init target before consent allows a real provider
 * to stand up. Keeps every call site a no-throw call regardless of environment.
 */
export const noopProvider: Provider = {
	init() {},
	capture() {},
	identify() {},
	reset() {},
	captureError() {},
	register() {},
	optIn() {},
	optOut() {},
	upgradePersistence() {},
	isFeatureEnabled() {
		return undefined;
	},
	shutdown() {},
};
