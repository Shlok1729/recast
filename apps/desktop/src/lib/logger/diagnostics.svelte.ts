/**
 * Opt-in diagnostic-logging switch, shared across windows.
 *
 * The Rust `AppConfig.diagnostic_logging` flag is the persistent source of
 * truth — it drives the actual runtime log level (see `apply_log_level`), so we
 * adopt its value on startup. `PersistedState` (localStorage) is layered on top
 * purely for instant, cross-window reactivity: flipping the toggle in the
 * Settings window must reach an already-open editor window's logger without a
 * reload, and Tauri webviews share a localStorage origin so a `storage` event
 * does exactly that.
 *
 * Off by default. When on, verbose backend + editor-interaction logs land in
 * the rotating log file for a support bundle. See `$lib/logger`.
 */

import { PersistedState } from "@recast/ui/persisted-state";

const STORAGE_KEY = "recast-diagnostic-logging";

function createDiagnosticsStore() {
	const state = new PersistedState<boolean>(STORAGE_KEY, false);

	// Adopt the backend's persisted value on startup so the toggle reflects the
	// real log level even after localStorage is cleared. Best-effort — a
	// non-Tauri preview just keeps the localStorage/default value.
	void import("@tauri-apps/api/core")
		.then(({ invoke }) => invoke<boolean>("get_diagnostic_logging"))
		.then((backend) => {
			if (typeof backend === "boolean") state.current = backend;
		})
		.catch(() => {});

	return {
		/** Reactive — read inside an `$effect`/`$derived` to track changes. */
		get enabled() {
			return state.current;
		},
		/** Persist the choice to localStorage (cross-window) AND Rust (log level). */
		set(value: boolean) {
			state.current = value;
			void import("@tauri-apps/api/core")
				.then(({ invoke }) => invoke("set_diagnostic_logging", { enabled: value }))
				.catch(() => {});
		},
	};
}

export const diagnostics = createDiagnosticsStore();
