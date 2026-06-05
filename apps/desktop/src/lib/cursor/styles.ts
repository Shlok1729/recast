/**
 * Curated cursor sprite library. Each style is an SVG so we can recolour and
 * resample at any DPI without bundling pixel assets.
 *
 * The sprite art lives as standalone files under `./sprites/*.svg` and is
 * pulled in at build time via `import.meta.glob` (`?raw`), so adding a new
 * variant is just: drop an `.svg` into `./sprites/`, then add a manifest entry
 * to `CURSOR_STYLES` below referencing it by bare filename through `sprite()`.
 * No string editing, no import bookkeeping.
 *
 * Coordinate system: every sprite is authored at 64×64 with the *click
 * hotspot* at `hotspot` (in sprite-space px). The preview overlay applies
 * `transform: translate(-hotspotX, -hotspotY)` so the cursor's tip lands on
 * the captured pointer position regardless of which sprite is selected.
 * Strokes use round joins/caps and inline filters for soft drop shadows so
 * every variant reads cleanly at the 32–96 px rendered scale users see in
 * playback. Filters are scoped via unique IDs to avoid clashes when multiple
 * sprites end up in the DOM.
 *
 * `dot` is the historical soft-circle path, drawn by the WebGL2 shader and
 * the Rust export overlay. `macos` adds an Apple-style cursor with two
 * sprites: the arrow shown at rest, and the link-pointing hand swapped in
 * while the captured cursor is mid-click. Per-state lookup happens via
 * `cursorStyleDataUrl(id, "press" | "rest")`.
 */

import type { CursorStyleId } from "$lib/stores/editor-store.svelte";

export interface CursorStyle {
  id: CursorStyleId;
  label: string;
  /** Short blurb shown under the swatch in the panel. */
  description: string;
  /** Authored at 64×64 with the click hotspot at `hotspot`. */
  svg: string;
  /** Optional pressed-state sprite swapped in while the captured cursor
   *  is mid-click. When omitted the rest sprite is reused. */
  pressedSvg?: string;
  hotspot: { x: number; y: number };
  pressedHotspot?: { x: number; y: number };
}

// Eagerly load every sprite as a raw SVG string at build time, keyed by its
// path (e.g. "./sprites/macos-arrow.svg"). Bundled into the build — no runtime
// filesystem access, so it works unchanged inside the Tauri WebView.
const spriteModules = import.meta.glob<string>("./sprites/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Resolve a sprite by its bare filename (no `./sprites/` prefix or `.svg`
 *  extension). Throws loudly at module init if a manifest entry points at a
 *  file that doesn't exist, so a typo surfaces immediately in dev rather than
 *  silently rendering an empty cursor. */
function sprite(name: string): string {
  const svg = spriteModules[`./sprites/${name}.svg`];
  if (!svg) {
    throw new Error(
      `cursor sprite "./sprites/${name}.svg" not found. Available: ${Object.keys(
        spriteModules,
      ).join(", ")}`,
    );
  }
  return svg;
}

export const CURSOR_STYLES: CursorStyle[] = [
  {
    id: "dot",
    label: "Soft dot",
    description: "Default — used for both preview and export.",
    // The actual `dot` cursor is drawn by the WebGL2 shader; this SVG is
    // only the picker swatch.
    svg: sprite("dot"),
    hotspot: { x: 32, y: 32 },
  },
  {
    id: "macos",
    label: "macOS",
    description: "Apple-style arrow that turns into the link pointer on click.",
    svg: sprite("macos-arrow"),
    pressedSvg: sprite("macos-pointer"),
    hotspot: { x: 8, y: 6 },
    pressedHotspot: { x: 12, y: 4 },
  },
  {
    id: "windows",
    label: "Windows 11",
    description: "Fluent-style white arrow that turns into the link pointer on click.",
    svg: sprite("windows-arrow"),
    pressedSvg: sprite("windows-pointer"),
    hotspot: { x: 10, y: 6 },
    pressedHotspot: { x: 12, y: 4 },
  },
  {
    id: "outline",
    label: "Outline",
    description: "Crisp white outline that turns into the link pointer on click.",
    svg: sprite("outline-arrow"),
    pressedSvg: sprite("outline-pointer"),
    hotspot: { x: 10, y: 6 },
    pressedHotspot: { x: 12, y: 4 },
  },
  {
    id: "target",
    label: "Target",
    description: "Precision reticle that locks on with a glow on click.",
    svg: sprite("target"),
    pressedSvg: sprite("target-press"),
    hotspot: { x: 32, y: 32 },
    pressedHotspot: { x: 32, y: 32 },
  },
];

export function getCursorStyle(id: CursorStyleId): CursorStyle {
  return CURSOR_STYLES.find((s) => s.id === id) ?? CURSOR_STYLES[0];
}

export type CursorStyleState = "rest" | "press";

export function cursorStyleHotspot(
  id: CursorStyleId,
  state: CursorStyleState = "rest",
): { x: number; y: number } {
  const style = getCursorStyle(id);
  if (state === "press" && style.pressedHotspot) return style.pressedHotspot;
  return style.hotspot;
}

/** Cached `data:image/svg+xml,…` URLs (one per id+state) so the `<img>`
 *  element in the overlay layer doesn't re-encode on every frame. */
const dataUrlCache = new Map<string, string>();
export function cursorStyleDataUrl(
  id: CursorStyleId,
  state: CursorStyleState = "rest",
): string {
  const key = `${id}:${state}`;
  const cached = dataUrlCache.get(key);
  if (cached) return cached;
  const style = getCursorStyle(id);
  const svg =
    state === "press" && style.pressedSvg ? style.pressedSvg : style.svg;
  const url =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(svg.trim().replace(/\n\s*/g, " "));
  dataUrlCache.set(key, url);
  return url;
}
