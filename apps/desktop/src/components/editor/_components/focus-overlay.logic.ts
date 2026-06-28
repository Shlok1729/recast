/**
 * Focus/zoom-region overlay geometry: the UV-space box a region occupies, its
 * resize-handle positions, hit-testing, and the cursor for a handle.
 *
 * NOTE: this is the zoom-region editor's own source-space geometry — it does NOT
 * use the zoom-aware/aspect-aware helpers in `$lib/annotations/uv.ts` (those are
 * for annotations, which live in zoomed space). Keep the two separate.
 */

export type HandleName =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "body";

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Half-size (px, pre-DPR) of a resize handle; also the draw size. */
export const HANDLE_RADIUS_PX = 6;

/** UV-space box for a zoom region: a `1/scale`-side square centred on (centerX, centerY), clamped inside [0,1]². */
export function regionBox(r: {
	scale: number;
	centerX: number;
	centerY: number;
}): Box {
	const s = Math.max(1.001, r.scale);
	const w = 1 / s;
	const h = 1 / s;
	const cx = Math.min(Math.max(r.centerX, w / 2), 1 - w / 2);
	const cy = Math.min(Math.max(r.centerY, h / 2), 1 - h / 2);
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The eight resize-handle anchor points around a px-space rect. */
export function handlePositions(
	x: number,
	y: number,
	w: number,
	h: number,
): Record<Exclude<HandleName, "body">, { x: number; y: number }> {
	return {
		nw: { x, y },
		n: { x: x + w / 2, y },
		ne: { x: x + w, y },
		e: { x: x + w, y: y + h / 2 },
		se: { x: x + w, y: y + h },
		s: { x: x + w / 2, y: y + h },
		sw: { x, y: y + h },
		w: { x, y: y + h / 2 },
	};
}

/** Which handle (or "body") a point hits in a px-space rect, or null. `dpr` scales the grab slop per display. */
export function hitTestHandle(
	pt: { x: number; y: number },
	x: number,
	y: number,
	w: number,
	h: number,
	dpr: number,
): HandleName | null {
	const slop = HANDLE_RADIUS_PX * dpr + 2 * dpr;
	const handles = handlePositions(x, y, w, h);
	for (const [name, p] of Object.entries(handles)) {
		if (Math.abs(pt.x - p.x) <= slop && Math.abs(pt.y - p.y) <= slop) {
			return name as HandleName;
		}
	}
	if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return "body";
	return null;
}

/** CSS cursor for a hovered handle. */
export function cursorForHandle(h: HandleName | null): string {
	switch (h) {
		case "nw":
		case "se":
			return "nwse-resize";
		case "ne":
		case "sw":
			return "nesw-resize";
		case "n":
		case "s":
			return "ns-resize";
		case "e":
		case "w":
			return "ew-resize";
		case "body":
			return "move";
		default:
			return "";
	}
}
