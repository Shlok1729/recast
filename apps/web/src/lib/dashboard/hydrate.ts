import type { Recast } from "$lib/dashboard/store.svelte";

/**
 * Server row shape the dashboard loaders return. Fields the home/analytics
 * loaders omit are optional here so all three callers type-check against one
 * mapper.
 */
export type RecastRow = {
	id: string;
	title: string;
	durationSec: number;
	createdAt: number;
	sizeBytes: number;
	source: string;
	provider: string | null;
	views: number;
	videoUrl?: string;
	posterUrl?: string | null;
	folderId?: string | null;
	tags?: string[];
	latestShareSlug?: string | null;
};

export type MapOpts = {
	/** Sign-on-read playback URL — false for surfaces that never play (analytics). */
	videoUrl?: boolean;
	/** Carry folder membership — false where folders aren't surfaced (home). */
	folders?: boolean;
	/** Carry tag ids — false where tags aren't surfaced (home/analytics). */
	tags?: boolean;
};

/**
 * Map server recast rows into the shared `Recast` store shape. Replaces the
 * hand-copied `.map()` block that lived in the home, library, and analytics
 * pages — the per-page divergences (which only library needs folders/tags,
 * analytics needs no playable URL) are expressed via `opts` instead of three
 * near-identical literals that drift.
 */
export function mapRecastsForStore(rows: RecastRow[], opts: MapOpts = {}): Recast[] {
	const { videoUrl = true, folders = true, tags = true } = opts;
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		durationSec: r.durationSec,
		createdAt: r.createdAt,
		sizeBytes: r.sizeBytes,
		source: r.source as Recast["source"],
		provider: r.provider,
		views: r.views,
		folderId: folders ? (r.folderId ?? null) : null,
		tags: tags ? (r.tags ?? []) : [],
		videoUrl: videoUrl ? (r.videoUrl ?? "") : "",
		posterUrl: r.posterUrl ?? "",
		latestShareSlug: r.latestShareSlug ?? null,
	}));
}
