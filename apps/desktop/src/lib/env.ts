/**
 * Build-time env for the desktop frontend. Only `PUBLIC_*` vars reach the webview
 * (see `envPrefix` in vite.config.ts). Rust reads the same `PUBLIC_POSTHOG_*` names
 * (telemetry.rs). Absent `PUBLIC_POSTHOG_KEY` makes the analytics client a no-op.
 */
export const POSTHOG_KEY: string | undefined = import.meta.env.PUBLIC_POSTHOG_KEY;
// `||` (not `??`) so an empty string (e.g. `PUBLIC_POSTHOG_HOST=`) falls back to
// the default. Mirrors the Rust side's `filter(|s| !s.is_empty())`.
export const POSTHOG_HOST: string =
	import.meta.env.PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
