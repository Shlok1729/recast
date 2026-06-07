/**
 * Asset registry — shared types.
 *
 * Tier 0 of the extensions architecture: a single addressable catalog for the
 * editor's visual assets (cursors, backgrounds, gradients, colours, easing and
 * cursor-smoothing presets). Built-in catalogs register their entries here at
 * load; installed extension packs (Tier 1) register theirs after hydration.
 *
 * Storage ids:
 *  - Built-ins keep their *exact legacy* storage form (a bare local id like
 *    `macos`, or a literal value such as a hex/gradient string for kinds that
 *    were historically stored inline). This guarantees old project files keep
 *    resolving with no migration.
 *  - Extension entries are addressed as `ext:<extId>:<localId>` so they never
 *    collide with built-ins and degrade gracefully when the pack is removed.
 */

import type { Easing } from "$lib/easing/cubic-bezier";

export type AssetKind =
	| "cursor"
	| "background"
	| "gradient"
	| "color"
	| "easing"
	| "smoothing";

export type Source =
	| { kind: "builtin" }
	| { kind: "extension"; extId: string };

/** Hotspot in sprite-space pixels (sprites are authored at 64×64). */
export interface Hotspot {
	x: number;
	y: number;
}

/** Per-kind `value` payloads carried by a {@link RegistryEntry}. */
export interface CursorValue {
	/** Raw SVG string (rest state). */
	svg: string;
	/** Optional pressed-state SVG swapped in mid-click. */
	pressedSvg?: string;
	hotspot: Hotspot;
	pressedHotspot?: Hotspot;
}
export interface BackgroundValue {
	/** The string the render pipeline consumes for `backgroundValue`:
	 *  `asset:<id>` (built-in wallpaper), an absolute file path (extension
	 *  wallpaper/image), a hex, or a CSS gradient. */
	wireValue: string;
}
export interface GradientValue {
	/** CSS `linear-gradient(...)` string — the source of truth both renderers parse. */
	value: string;
}
export interface ColorValue {
	/** Hex colour. */
	value: string;
}
export interface EasingValue {
	value: Easing;
}
export interface SmoothingValue {
	smoothing: number;
	snapToClicks: boolean;
	snapWindowMs: number;
}

export type RegistryValueFor<K extends AssetKind> = K extends "cursor"
	? CursorValue
	: K extends "background"
		? BackgroundValue
		: K extends "gradient"
			? GradientValue
			: K extends "color"
				? ColorValue
				: K extends "easing"
					? EasingValue
					: K extends "smoothing"
						? SmoothingValue
						: never;

export interface RegistryEntry<K extends AssetKind = AssetKind> {
	/** Storage id — see module docs. Unique within a kind. */
	id: string;
	kind: K;
	label: string;
	source: Source;
	value: RegistryValueFor<K>;
	/** Optional secondary line shown under the swatch in pickers. */
	description?: string;
	/** Asset id (extension manifest-local) whose hydrated thumbnail represents
	 *  this entry in the picker. Built-ins typically omit this. */
	thumbAssetId?: string;
	/** Ready-to-use WebView thumbnail URL (`convertFileSrc` of a hydrated
	 *  extension asset). Set for extension entries; built-ins instead resolve a
	 *  thumbnail from {@link thumbAssetId} via the assets store. */
	thumbUrl?: string;
}

/** Prefix marking an extension-contributed storage id. */
export const EXT_PREFIX = "ext:";

/** Build the storage id for an extension-contributed entry. */
export function extEntryId(extId: string, localId: string): string {
	return `${EXT_PREFIX}${extId}:${localId}`;
}

/** True when a stored id refers to an extension-contributed entry. */
export function isExtId(id: string): boolean {
	return id.startsWith(EXT_PREFIX);
}

/** Parse `ext:<extId>:<localId>` → `{ extId, localId }`, or null if not an
 *  extension id (or malformed). `localId` may itself contain colons. */
export function parseExtId(id: string): { extId: string; localId: string } | null {
	if (!isExtId(id)) return null;
	const rest = id.slice(EXT_PREFIX.length);
	const sep = rest.indexOf(":");
	if (sep <= 0 || sep >= rest.length - 1) return null;
	return { extId: rest.slice(0, sep), localId: rest.slice(sep + 1) };
}
