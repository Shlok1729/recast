// Capture-capability gating for feature entry points.
//
// The Settings panel renders the full matrix; this module is the *gate* the
// rest of the app calls before letting a user turn a capture input on. It
// caches the one `capture_capabilities` probe and turns an unsupported feature
// into a ready-to-toast verdict whose wording depends on WHY it's off:
//   - `unsupported` → the OS / native API can't do it → "not supported on <os>"
//   - `planned`     → we just haven't shipped it here yet → "not available yet"
//
// Fails OPEN: if the probe errors or the key is unknown, the verdict is `ok`
// so a diagnostic hiccup never blocks a feature that might actually work.

import { captureCapabilities, type CaptureCapabilities } from "$lib/ipc";

let cached: Promise<CaptureCapabilities> | null = null;

/** Load (and cache) the capture-support matrix. Pass `force` to re-probe. */
export function loadCapabilities(force = false): Promise<CaptureCapabilities> {
	if (force || !cached) cached = captureCapabilities();
	return cached;
}

export type CapabilityVerdict =
	| { ok: true }
	| { ok: false; reason: "unsupported" | "planned"; message: string };

const OS_LABEL: Record<string, string> = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
};

/**
 * Decide whether `key` (a `CaptureCapability.key`) is usable on this device.
 * On `ok: false` the `message` is a finished, user-facing sentence ready to
 * drop into a toast — the caller just picks the surface.
 */
export async function checkCapability(
	key: string,
	fallbackLabel = "This feature",
): Promise<CapabilityVerdict> {
	let caps: CaptureCapabilities;
	try {
		caps = await loadCapabilities();
	} catch {
		// Couldn't run the probe — don't punish the user for a diagnostic that
		// failed; let them try and surface the real error at use time.
		return { ok: true };
	}

	const capability = caps.capabilities.find((c) => c.key === key);
	// Unknown key, or genuinely supported → allow.
	if (!capability || capability.supported || capability.status === "supported") {
		return { ok: true };
	}

	const label = capability.label || fallbackLabel;
	const os = OS_LABEL[caps.platform] ?? "this system";

	if (capability.status === "planned") {
		return {
			ok: false,
			reason: "planned",
			message: capability.note
				? `${label} isn't available yet — ${capability.note}`
				: `${label} isn't available yet — it's coming in a future update.`,
		};
	}

	return {
		ok: false,
		reason: "unsupported",
		message: capability.note
			? `${label} isn't supported on ${os} — ${capability.note}`
			: `${label} isn't supported on ${os}.`,
	};
}
