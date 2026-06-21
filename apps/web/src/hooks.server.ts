import { building } from "$app/environment";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { getAuth } from "$lib/auth/server";
import { getServerEnv } from "$lib/env/server";
import { getPublicEnv } from "$lib/env/public";
import type { Handle, HandleServerError } from "@sveltejs/kit";

// Validate env at server startup. Throws synchronously if anything is missing
// or malformed so the process refuses to serve traffic with a half-configured
// .env instead of failing inside a request handler later. `building` skips this
// during the prerender pass where env isn't available.
if (!building) {
	getServerEnv();
	getPublicEnv();
}

export const handle: Handle = async ({ event, resolve }) => {
	return svelteKitHandler({ event, resolve, auth: getAuth(), building });
};

/**
 * Single funnel for unhandled/unexpected errors (errors thrown outside an
 * explicit `error(status, …)`). Expected client errors (4xx, including the
 * 404s `requireAdmin` raises) are passed through with their message; anything
 * 5xx is logged with its full stack server-side and returned to the client as
 * a generic message + correlation id, so internals never leak. `error(status)`
 * calls in handlers still produce their own response — this catches the rest.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	if (status < 500) {
		return { message };
	}

	const errorId = crypto.randomUUID();
	console.error(
		`[error ${errorId}] ${event.request.method} ${event.url.pathname} → ${status}`,
		error instanceof Error ? (error.stack ?? error.message) : error,
	);

	return { message: "Internal error", errorId };
};
