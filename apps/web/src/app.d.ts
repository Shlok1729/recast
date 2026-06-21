// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// Shape of the object `handleError` returns and `$page.error` exposes.
		// `errorId` correlates a user-facing message with the full stack logged
		// server-side, so support can find the log line without leaking internals.
		interface Error {
			message: string;
			errorId?: string;
		}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Injected by Vite `define` — the running web build version, used as an
	// analytics super-property.
	const __APP_VERSION__: string;
}

export {};
