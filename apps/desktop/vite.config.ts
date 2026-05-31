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
		include: ['posthog-js'],
		exclude: ['@recast/analytics'],
	},
	// Env variables starting with the item of `envPrefix` will be exposed in tauri's source code through `import.meta.env`.
	envPrefix: ['VITE_', 'TAURI_ENV_*']
});
