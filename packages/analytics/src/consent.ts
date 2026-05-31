import type { ConsentState } from "./types";

/**
 * Consent defaults + pure predicates. The actual enforcement lives in
 * `core.ts`; this module just defines the rules so they can be unit-tested
 * without a provider or a browser.
 *
 * Default here is the strictest stance (both OFF). Each app overrides at
 * construction: web grants `product` (cookieless, anonymous) and `errors` by
 * default; desktop keeps `product` OFF (opt-in) and `errors` ON (default opt-in).
 */
export const DEFAULT_CONSENT: ConsentState = { product: false, errors: false };

/** May we send behaviour / engagement events? */
export function canCapture(consent: ConsentState): boolean {
	return consent.product === true;
}

/** May we send error / crash reports? */
export function canReportErrors(consent: ConsentState): boolean {
	return consent.errors === true;
}

/** Is the provider worth standing up at all (any channel enabled)? */
export function anyConsent(consent: ConsentState): boolean {
	return consent.product === true || consent.errors === true;
}
