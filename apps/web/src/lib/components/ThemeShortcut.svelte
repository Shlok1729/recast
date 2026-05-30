<script lang="ts">
	/**
	 * Global keyboard shortcut for toggling light/dark mode in the web app.
	 *
	 * Renders no UI — just registers a `keydown` listener on `document` for
	 * `Cmd/Ctrl + Shift + L` (L for "lights"). Picked over single-key
	 * shortcuts (e.g. `T`) because the marketing site has plain-text
	 * surfaces (waitlist input, dashboard search) where a bare letter would
	 * hijack typing. The modifier combo doesn't collide with browser
	 * defaults on any platform.
	 *
	 * Skips when focus is inside an editable element so even with the
	 * modifier combo the user can't accidentally toggle mid-type. Surfaces
	 * a low-key toast so the change feels intentional rather than a
	 * "did the page just flicker?" moment.
	 */
	import { toast } from "@recast/ui/sonner";
	import { mode, toggleMode } from "@recast/ui/theme";
	import { onMount } from "svelte";

	function isEditable(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable) return true;
		const tag = target.tagName;
		return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
	}

	function handleKeydown(e: KeyboardEvent) {
		// `key` lowercases to "l" regardless of Shift, so we don't need to
		// compare against "L". Match either Cmd (mac) or Ctrl (win/linux).
		if (e.key?.toLowerCase() !== "l") return;
		if (!e.shiftKey) return;
		if (!(e.metaKey || e.ctrlKey)) return;
		if (isEditable(e.target)) return;

		e.preventDefault();
		toggleMode();
		// Read AFTER toggleMode so the toast reflects the NEW mode. mode is
		// a reactive store from mode-watcher; `.current` updates synchronously
		// on toggle so this is the destination, not the previous value.
		toast.info(
			`Switched to ${mode.current === "dark" ? "dark" : "light"} mode`,
			{ duration: 1600 },
		);
	}

	onMount(() => {
		document.addEventListener("keydown", handleKeydown);
		return () => document.removeEventListener("keydown", handleKeydown);
	});
</script>
