// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
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
