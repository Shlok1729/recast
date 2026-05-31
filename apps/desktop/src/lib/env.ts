/**
 * Build-time env for the desktop frontend. Only `VITE_*` vars are exposed to
 * the webview (see `envPrefix` in vite.config.ts). When `VITE_POSTHOG_KEY` is
 * absent the analytics client is a no-op — same "missing config disables it"
 * rule the web app and storage layer use.
 */
export const POSTHOG_KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY;
export const POSTHOG_HOST: string =
	import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com";
