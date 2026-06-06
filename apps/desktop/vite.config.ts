import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };



export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit()
	],
	define: {
		__NAME__: `"${pkg.name}"`,
		__VERSION__: `"${pkg.version}"`,
	},
	clearScreen: false,
	server: {
		port: 4421,
		strictPort: true,
		host: "0.0.0.0",
		watch: {
			// tell vite to ignore watching `src-tauri`
			ignored: ['**/src-tauri/**'],
		},

	},
	optimizeDeps: {
		// posthog-js is a transitive (dynamically-imported) dep of
		// @recast/analytics; pre-bundle it so the first capture in the webview
		// doesn't trigger a dep-optimize reload. Keep the workspace package itself
		// out so edits hot-reload.
		include: ['@recast/analytics'],
		// exclude: ['@recast/analytics'],
	},
	// Env variables starting with the item of `envPrefix` are exposed to the
	// webview via `import.meta.env`. We use the `PUBLIC_` prefix (matching the
	// web app and SvelteKit's convention) rather than `VITE_` so the SAME var
	// name — e.g. `PUBLIC_POSTHOG_KEY` — can be consumed by BOTH the Svelte
	// frontend (here) and the Rust backend (which reads it prefix-agnostically
	// via std::env::var / option_env!). `TAURI_ENV_*` is Tauri's own injected
	// build context and must stay.
	envPrefix: ['PUBLIC_', 'TAURI_ENV_*']
});
