/**
 * Pure helpers for BackgroundPicker — colour interpolation, gradient-stop
 * sampling, and background `image` value classification. Extracted from the
 * component so the maths is testable and the `.svelte` file is just wiring.
 */

/** A gradient colour stop: `color` is a hex string, `pos` is 0..100. */
export interface GradientStop {
	color: string;
	pos: number;
}

/** Linearly interpolate two `#rrggbb` hex colours in sRGB. `f` is 0..1. */
export function lerpHex(c0: string, c1: string, f: number): string {
	const parse = (h: string): [number, number, number] => {
		const s = h.replace("#", "");
		return [
			parseInt(s.slice(0, 2), 16),
			parseInt(s.slice(2, 4), 16),
			parseInt(s.slice(4, 6), 16),
		];
	};
	const [r0, g0, b0] = parse(c0);
	const [r1, g1, b1] = parse(c1);
	const mix = (a: number, b: number) =>
		Math.round(a + (b - a) * f)
			.toString(16)
			.padStart(2, "0");
	return `#${mix(r0, r1)}${mix(g0, g1)}${mix(b0, b1)}`;
}

/**
 * Colour of a gradient at position `pos` (0..100), interpolating between the
 * surrounding stops in sRGB — mirrors the renderer so an inserted stop is
 * visually neutral. Stops need not be pre-sorted.
 */
export function sampleStopColor(stops: GradientStop[], pos: number): string {
	const sorted = [...stops].sort((a, b) => a.pos - b.pos);
	if (pos <= sorted[0].pos) return sorted[0].color;
	const last = sorted[sorted.length - 1];
	if (pos >= last.pos) return last.color;
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (pos >= a.pos && pos <= b.pos) {
			const f = (pos - a.pos) / Math.max(b.pos - a.pos, 1e-6);
			return lerpHex(a.color, b.color, f);
		}
	}
	return last.color;
}

/** Values that are NOT images even if they linger in `backgroundValue` after a
 * tab switch (gradient strings, colour hex, internal asset ids). */
function isNonImageValue(value: string): boolean {
	return (
		value.includes("gradient(") ||
		value.startsWith("#") ||
		value.startsWith("asset:")
	);
}

/** Sources that can be shown directly without going through `convertFileSrc`. */
function isDirectSrc(value: string): boolean {
	return (
		value.startsWith("data:") ||
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("asset://") ||
		value.startsWith("/wallpapers/")
	);
}

/**
 * Whether `value` is usable as a background image. Rejects gradient/colour/asset
 * leftovers (which would otherwise hit Tauri's asset protocol and log "file does
 * not exist"), accepts direct sources and recognised image extensions.
 */
export function isValidImageValue(value: string): boolean {
	if (!value) return false;
	if (isNonImageValue(value)) return false;
	return (
		isDirectSrc(value) ||
		value.endsWith(".png") ||
		value.endsWith(".jpg") ||
		value.endsWith(".jpeg") ||
		value.endsWith(".webp")
	);
}

/**
 * Resolve a background `image` value to a `src`. Returns `""` for non-image
 * leftovers, the value as-is for direct sources, and otherwise the value run
 * through `resolve` (inject `convertFileSrc` at the call site so this stays
 * Tauri-free and testable).
 */
export function imagePreviewSrc(
	value: string,
	resolve: (v: string) => string,
): string {
	if (!value) return "";
	if (isNonImageValue(value)) return "";
	if (isDirectSrc(value)) return value;
	return resolve(value);
}
