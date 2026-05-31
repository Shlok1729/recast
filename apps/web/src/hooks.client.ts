import type { HandleClientError } from "@sveltejs/kit";
import { analytics } from "$lib/analytics/client";

/**
 * Client-side error tracking. SvelteKit routes uncaught render/load errors here;
 * we forward a scrubbed `$exception` to PostHog. Web error capture is
 * anonymous + cookieless + PII-scrubbed, so it runs by default (the client's
 * `errors` consent is on). Returns nothing special so SvelteKit still renders
 * its normal error page.
 */
export const handleError: HandleClientError = ({ error, event }) => {
	analytics.captureError(error, {
		source: "web",
		route: event.url?.pathname,
	});
};
