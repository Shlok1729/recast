// Workspace-scoped LRU of colors recently picked from the annotation color
// pickers. Bleeds across projects deliberately — the user's preferred palette
// follows them, not the file. Synced to localStorage on every commit so
// restarts preserve the list. Capped to 12 entries.

import { safeStorage } from "@recast/ui/persisted-state";

const STORAGE_KEY = "recast.annotations.recentColors";
const MAX = 12;

let cache: string[] | null = null;

function read(): string[] {
	if (cache) return cache;
	// `safeStorage` handles missing key, no-window, malformed JSON, and the
	// array-shape guard; we still string-filter + cap defensively.
	const parsed = safeStorage.get<string[]>(STORAGE_KEY, []);
	cache = parsed.filter((c) => typeof c === "string").slice(0, MAX);
	return cache;
}

function write(next: string[]) {
	cache = next;
	safeStorage.set(STORAGE_KEY, next);
}

export function getRecentColors(): string[] {
	return read().slice();
}

/**
 * Push `color` to the front of the LRU. No-op when `color` is empty,
 * "transparent", or `inherit` — those aren't meaningful entries to recall.
 */
export function pushRecentColor(color: string): string[] {
	const trimmed = color.trim();
	if (!trimmed || trimmed === "transparent" || trimmed === "inherit") {
		return getRecentColors();
	}
	const existing = read().filter((c) => c.toLowerCase() !== trimmed.toLowerCase());
	const next = [trimmed, ...existing].slice(0, MAX);
	write(next);
	return next.slice();
}

export function clearRecentColors() {
	write([]);
}
