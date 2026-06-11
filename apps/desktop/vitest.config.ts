import { defineConfig } from "vitest/config";

// Standalone vitest config — intentionally does NOT load the SvelteKit/Tailwind
// plugins from vite.config.ts. The unit suite targets pure, framework-free
// logic (timeline math, time mapping, etc.), so a plain Node environment keeps
// the tests fast and free of browser/Svelte setup.
export default defineConfig({
	test: {
		include: ["src/**/*.{test,spec}.ts"],
		environment: "node",
	},
});
