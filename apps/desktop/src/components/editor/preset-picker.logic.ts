/**
 * Pure helpers for PresetPicker — fuzzy search scoring, thumbnail styling, and
 * aspect/wallpaper string mapping. Extracted from the component so the search
 * ranking and frame maths are testable. The keyboard-nav state machine stays in
 * the component (it owns reactive cursor state).
 *
 * Functions take a structural `PresetLike` (the subset of `Preset` they read)
 * so this module doesn't depend on the component's exported `Preset` type.
 */

export interface PresetLike {
	label: string;
	category: string;
	aspect: string;
	description?: string;
	keywords?: string[];
	bg?: string;
	value?: string;
}

/**
 * Relevance of a preset to query `q` (higher = better, 0 = no match). Ranks
 * label/category prefix highest, then substring matches, then description,
 * keywords, and aspect. Empty query matches everything (returns 1).
 */
export function score(p: PresetLike, q: string): number {
	if (!q) return 1;
	const n = q.toLowerCase();
	const label = p.label.toLowerCase();
	const cat = p.category.toLowerCase();
	if (label.startsWith(n)) return 100;
	if (cat.startsWith(n)) return 90;
	if (label.includes(n)) return 80;
	if (cat.includes(n)) return 60;
	if ((p.description ?? "").toLowerCase().includes(n)) return 40;
	if ((p.keywords ?? []).some((k) => k.toLowerCase().includes(n))) return 30;
	if (p.aspect.toLowerCase().includes(n)) return 20;
	return 0;
}

/** Inline style for a preset's thumbnail background. */
export function bgPreviewStyle(p: PresetLike): string {
	if ((p.bg === "gradient" || p.bg === "color") && p.value)
		return `background:${p.value}`;
	return "background:var(--color-muted)";
}

/**
 * WYSIWYG frame inset percent. `padding` is a percent of the shorter source
 * edge and the canvas is source+padding on each side, so the video occupies
 * `1/(1+2p)` of that edge — this mirrors that so the thumbnail frames like the
 * real export. Capped at 20%.
 */
export function frameInsetPct(padding: number): number {
	const p = Math.max(0, padding) / 100;
	return Math.min(20, (p / (1 + 2 * p)) * 100);
}

/** The registry id for a wallpaper preset (strips the `asset:`/`asset://`). */
export function wallpaperId(p: PresetLike): string {
	return (p.value ?? "").replace(/^asset:\/\/?/, "").replace(/^asset:/, "");
}

/** Tailwind aspect class for a preset aspect string. */
export function aspectClass(aspect: string): string {
	switch (aspect) {
		case "1:1":
			return "aspect-square";
		case "9:16":
			return "aspect-[9/16]";
		case "16:9":
			return "aspect-video";
		case "1.91:1":
			return "aspect-[1.91/1]";
		default:
			return "aspect-video";
	}
}
