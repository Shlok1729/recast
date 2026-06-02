/**
 * The persistent, anonymous install id — the desktop's analytics `distinct_id`
 * before sign-in. Stored under the same `trace_install_id` localStorage key the
 * `user-store` defines, so the JS analytics client, the Rust crash reporter, and
 * the user store all attribute to the same anonymous person.
 *
 * Standalone module (no analytics/posthog imports) so both the consent store and
 * the analytics client can read it without an import cycle.
 */
import { safeStorage } from "@recast/ui/persisted-state";

const INSTALL_ID_KEY = "trace_install_id";

export function getInstallId(): string {
	// Keep the explicit sentinel for the truly storage-less case so the crash
	// reporter still has a stable id during prerender / no-window contexts.
	if (typeof window === "undefined") return "anonymous-desktop";
	let id = safeStorage.get<string>(INSTALL_ID_KEY, "");
	if (!id) {
		id = crypto.randomUUID();
		// Best-effort persist; on quota/private-mode the ephemeral id is used.
		safeStorage.set(INSTALL_ID_KEY, id);
	}
	return id;
}
