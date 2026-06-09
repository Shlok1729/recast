import { PersistedState } from "@recast/ui/persisted-state";

export type LayoutMode = "os-native" | "recast";

/** Option metadata for the Settings → General segmented control. */
export const LAYOUT_MODES: {
  value: LayoutMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "os-native",
    label: "OS native",
    hint: "Window controls follow your operating system — traffic lights on the left on macOS, min / max / close on the right on Windows & Linux.",
  },
  {
    value: "recast",
    label: "Recast",
    hint: "Recast's own unified titlebar, identical on every OS.",
  },
];

/**
 * App-shell chrome preference. Pure UI state (no Rust round-trip), exposed as a
 * single shared `PersistedState` so the Settings toggle and the `(app)` shell
 * read and react to the same reactive value within the window. Persists in
 * localStorage and broadcasts across windows that share the origin.
 *
 * Default `os-native` keeps the shipped chrome; `recast` is the opt-in classic.
 */
export const layoutMode = new PersistedState<LayoutMode>(
  "recast-layout-mode",
  "os-native",
);
