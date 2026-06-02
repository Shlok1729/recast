/**
 * Desktop telemetry consent, persisted to localStorage AND mirrored into the
 * Rust `AppConfig` so the native crash reporter can read the `errors` flag.
 *
 * Defaults encode the hard rule agreed with the user:
 *   - `product` (behaviour / engagement analytics): OFF — strictly opt-in.
 *   - `errors`  (crash / error reporting):          ON  — default opt-in, with
 *     an explicit toggle to turn it off.
 *
 * Backed by the shared `PersistedState` primitive (`@recast/ui/persisted-state`)
 * for localStorage persistence + cross-window `storage` sync (Tauri v2 webviews
 * share a localStorage origin, so flipping a toggle in the settings window
 * reaches open editor windows without a reload), with the Rust mirror layered
 * on top in the setters.
 */

import { PersistedState, safeStorage } from "@recast/ui/persisted-state";
import { getInstallId } from "$lib/analytics/identity";

export interface DesktopConsent {
	product: boolean;
	errors: boolean;
}

const DEFAULTS: DesktopConsent = { product: false, errors: true };

const STORAGE_KEY = "recast-telemetry-consent";
const SEEN_KEY = "recast-consent-seen";

/**
 * Mirror consent into Rust so the panic hook / error reporter can read
 * `errors` and attribute crashes to the same anonymous install id as JS
 * events. Called on every explicit toggle (not on cross-window re-reads — the
 * window that made the change already mirrored it to the shared backend).
 */
function mirrorToRust(consent: DesktopConsent) {
	void import("@tauri-apps/api/core")
		.then(({ invoke }) =>
			invoke("set_telemetry_consent", {
				product: consent.product,
				errors: consent.errors,
				installId: getInstallId(),
			}),
		)
		.catch(() => {
			// Non-Tauri preview or pre-command build — JS-side gating still applies.
		});
}

function createConsentStore() {
	// localStorage-backed reactive consent with cross-window `storage` sync:
	// flipping a toggle in the settings window reaches open editor windows
	// without a reload. The JSON value is merged over DEFAULTS, so a consent
	// key added in a future build keeps its default for existing users.
	const consent = new PersistedState<DesktopConsent>(STORAGE_KEY, DEFAULTS);

	return {
		get product() {
			return consent.current.product;
		},
		get errors() {
			return consent.current.errors;
		},
		/** Has the first-run privacy moment been shown + dismissed yet? */
		get hasSeenFirstRun() {
			// During SSR / no-window previews, treat as seen so the prompt never
			// flashes before storage is readable.
			if (typeof window === "undefined") return true;
			return safeStorage.get<string>(SEEN_KEY, "") === "1";
		},
		markFirstRunSeen() {
			safeStorage.set(SEEN_KEY, "1");
		},
		setProduct(value: boolean) {
			consent.current = { ...consent.current, product: value };
			mirrorToRust(consent.current);
		},
		setErrors(value: boolean) {
			consent.current = { ...consent.current, errors: value };
			mirrorToRust(consent.current);
		},
	};
}

export const desktopConsent = createConsentStore();
