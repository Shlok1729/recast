/**
 * Desktop telemetry consent, persisted to localStorage AND mirrored into the
 * Rust `AppConfig` so the native crash reporter can read the `errors` flag.
 *
 * Defaults encode the hard rule agreed with the user:
 *   - `product` (behaviour / engagement analytics): OFF — strictly opt-in.
 *   - `errors`  (crash / error reporting):          ON  — default opt-in, with
 *     an explicit toggle to turn it off.
 *
 * Clones the `experimental.svelte.ts` pattern: a localStorage-backed `$state`
 * rune with cross-window `storage` sync (Tauri v2 webviews share a localStorage
 * origin, so flipping a toggle in the settings window reaches open editor
 * windows without a reload).
 */

import { getInstallId } from "$lib/analytics/identity";

export interface DesktopConsent {
	product: boolean;
	errors: boolean;
}

const DEFAULTS: DesktopConsent = { product: false, errors: true };

const STORAGE_KEY = "recast-telemetry-consent";
const SEEN_KEY = "recast-consent-seen";

function load(): DesktopConsent {
	if (typeof localStorage === "undefined") return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<DesktopConsent>;
		return { ...DEFAULTS, ...parsed };
	} catch {
		return { ...DEFAULTS };
	}
}

function persist(consent: DesktopConsent) {
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
		} catch {
			// Quota / private mode — best effort.
		}
	}
	// Mirror into Rust so the panic hook / error reporter can read `errors`
	// and attribute crashes to the same anonymous install id as JS events.
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
	let consent = $state<DesktopConsent>(load());

	if (typeof window !== "undefined") {
		window.addEventListener("storage", (e) => {
			if (e.key !== STORAGE_KEY) return;
			consent = load();
		});
	}

	return {
		get product() {
			return consent.product;
		},
		get errors() {
			return consent.errors;
		},
		/** Has the first-run privacy moment been shown + dismissed yet? */
		get hasSeenFirstRun() {
			if (typeof localStorage === "undefined") return true;
			return localStorage.getItem(SEEN_KEY) === "1";
		},
		markFirstRunSeen() {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(SEEN_KEY, "1");
			} catch {
				/* best effort */
			}
		},
		setProduct(value: boolean) {
			consent = { ...consent, product: value };
			persist(consent);
		},
		setErrors(value: boolean) {
			consent = { ...consent, errors: value };
			persist(consent);
		},
	};
}

export const desktopConsent = createConsentStore();
