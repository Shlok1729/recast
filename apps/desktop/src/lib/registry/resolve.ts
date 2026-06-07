/**
 * Registry resolvers — turn a *stored* id/value into what a consumer needs,
 * with graceful fallback when an extension-contributed id is missing (pack
 * uninstalled). Resolvers NEVER throw: a missing `ext:` id degrades to a
 * built-in default and logs a warning, so export/preview can't crash on a
 * removed pack.
 */

import { log } from "$lib/logger";
import { registry } from "./registry.svelte";
import {
	isExtId,
	type CursorValue,
	type EasingValue,
	type SmoothingValue,
} from "./types";

/** Safe fallback background when an `ext:` background can't be resolved. */
const FALLBACK_BACKGROUND = "#111111";

/**
 * Resolve a stored `backgroundValue` to the string the render pipeline
 * consumes. Built-in values (hex, gradient, `asset:<id>`) pass through
 * unchanged — identity. Only `ext:<extId>:<localId>` references hit the
 * registry, mapping to the pack's hydrated absolute file path.
 */
export function resolveBackgroundWireValue(value: string): string {
	if (!isExtId(value)) return value;
	const entry = registry.get("background", value);
	if (entry) return entry.value.wireValue;
	log.warn("registry", "background_missing", { id: value });
	return FALLBACK_BACKGROUND;
}

/**
 * Resolve a stored cursor style id to its sprite payload (svg + hotspots).
 * Returns `null` when the id can't be resolved — callers treat that as "fall
 * back to the soft-dot cursor" rather than failing the export.
 */
export function resolveCursorSprite(id: string): CursorValue | null {
	const entry = registry.get("cursor", id);
	if (entry) return entry.value;
	if (isExtId(id)) {
		log.warn("registry", "cursor_missing", { id });
	}
	return null;
}

/** Cached `data:image/svg+xml,…` URLs (one per id+state) so the preview
 *  overlay `<img>` doesn't re-encode the SVG every frame. */
const cursorDataUrlCache = new Map<string, string>();

/**
 * Resolve a stored cursor id + state to a preview-ready SVG data URL, for
 * both built-ins and `ext:` packs. Returns null when unresolvable (caller
 * hides the overlay rather than rendering a broken image).
 */
export function resolveCursorDataUrl(
	id: string,
	state: "rest" | "press",
): string | null {
	const key = `${id}:${state}`;
	const cached = cursorDataUrlCache.get(key);
	if (cached) return cached;
	const sprite = resolveCursorSprite(id);
	if (!sprite) return null;
	const svg =
		state === "press" && sprite.pressedSvg ? sprite.pressedSvg : sprite.svg;
	const url =
		"data:image/svg+xml;utf8," +
		encodeURIComponent(svg.trim().replace(/\n\s*/g, " "));
	cursorDataUrlCache.set(key, url);
	return url;
}

/** Resolve a stored easing preset id to its {@link Easing} value, or null. */
export function resolveEasing(id: string): EasingValue["value"] | null {
	return registry.get("easing", id)?.value.value ?? null;
}

/** Resolve a stored smoothing preset id to its parameters, or null. */
export function resolveSmoothing(id: string): SmoothingValue | null {
	return registry.get("smoothing", id)?.value ?? null;
}
