/**
 * The persistent, anonymous install id — the desktop's analytics `distinct_id`
 * before sign-in. Stored under the same `trace_install_id` localStorage key the
 * `user-store` defines, so the JS analytics client, the Rust crash reporter, and
 * the user store all attribute to the same anonymous person.
 *
 * Standalone module (no analytics/posthog imports) so both the consent store and
 * the analytics client can read it without an import cycle.
 */
const INSTALL_ID_KEY = "trace_install_id";

export function getInstallId(): string {
	if (typeof localStorage === "undefined") return "anonymous-desktop";
	let id = localStorage.getItem(INSTALL_ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		try {
			localStorage.setItem(INSTALL_ID_KEY, id);
		} catch {
			// private mode / quota — fall back to the ephemeral id for this run.
		}
	}
	return id;
}
