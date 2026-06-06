/**
 * Build-time env for the desktop frontend. Only `PUBLIC_*` vars are exposed to
 * the webview (see `envPrefix` in vite.config.ts). The `PUBLIC_` prefix is
 * shared with the Rust backend — Rust reads the exact same `PUBLIC_POSTHOG_*`
 * names (telemetry.rs) — and matches the web app's convention. When
 * `PUBLIC_POSTHOG_KEY` is absent the analytics client is a no-op — same
 * "missing config disables it" rule the web app and storage layer use.
 */
export const POSTHOG_KEY: string | undefined = import.meta.env.PUBLIC_POSTHOG_KEY;
// `||` (not `??`) so an empty string — e.g. an unset CI secret written as
// `PUBLIC_POSTHOG_HOST=` — still falls back to the default rather than an empty
// host. Mirrors the Rust side's `filter(|s| !s.is_empty())`.
export const POSTHOG_HOST: string =
	import.meta.env.PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
