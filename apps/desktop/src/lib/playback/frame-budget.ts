/**
 * Resolution-adaptive decoded-frame budget for the WebCodecs source.
 *
 * Each decoded `VideoFrame` checks out one of the hardware decoder's limited
 * output surfaces; holding too many starves the pool and the decoder stalls
 * (accepts input, emits nothing → ~8fps). A fixed frame count is therefore
 * wrong across resolutions: 7 frames is fine at 1080p but the same 7 frames at
 * 4K/5K (macOS records full native Retina, no downscale) holds 4–7× the surface
 * memory and re-triggers the stall — made worse now that the scout decoder holds
 * additional pre-warmed frames at the same time.
 *
 * So we scale ALL three holders down together with pixel count, against a fixed
 * surface-memory budget:
 *   - `cacheMax`    — the primary decoded-frame cache (display + lookahead)
 *   - `holdoutMax`  — the protected scout (cross-cut prefetch) holdout
 *   - `decodeAhead` — how far the worker decodes past the playhead
 *
 * At ≤1440p this returns the historical 7 / 4 / 6 (unchanged, known-good); at
 * 4K/5K it tightens to keep the TOTAL held surfaces bounded. Pure + unit-tested.
 */

/**
 * Bytes assumed per decoded frame per pixel. Raw yuv420p is 1.5 B/px, but
 * hardware decode surfaces are padded/tiled and often NV12/RGBA-backed, so we
 * budget a conservative 4 B/px to stay safely under the real output pool.
 */
const BYTES_PER_PX = 4;

/** Total decoded-surface memory we're willing to hold at once (~192 MB). */
const SURFACE_BUDGET_BYTES = 192 * 1024 * 1024;

/** Clamp range for the combined frame count (primary cache + scout holdout). */
const MIN_TOTAL_FRAMES = 6;
const MAX_TOTAL_FRAMES = 11;

export interface FrameBudget {
	/** Cap for the primary decoded-frame cache. */
	cacheMax: number;
	/** Cap for the scout (cross-cut prefetch) holdout. */
	holdoutMax: number;
	/** How many samples the worker decodes ahead of the playhead. */
	decodeAhead: number;
}

/**
 * Compute the decoded-frame budget for a `width`×`height` source. Falls back to
 * the generous (low-res) budget when dimensions are unknown/invalid.
 */
export function frameBudget(width: number, height: number): FrameBudget {
	const pixels = width > 0 && height > 0 ? width * height : 0;
	const perFrame = pixels > 0 ? pixels * BYTES_PER_PX : 0;

	// Total surfaces we'll hold across the cache + holdout, bounded.
	const total =
		perFrame > 0
			? Math.min(
					MAX_TOTAL_FRAMES,
					Math.max(MIN_TOTAL_FRAMES, Math.floor(SURFACE_BUDGET_BYTES / perFrame)),
				)
			: MAX_TOTAL_FRAMES;

	// Reserve up to 4 for the scout holdout, shrinking it first as the budget
	// tightens (the primary cache matters more for steady playback).
	const holdoutMax = Math.min(4, Math.max(2, total - 5));
	const cacheMax = Math.max(4, total - holdoutMax);
	// Don't decode further ahead than the cache can hold, or those frames are
	// evicted on arrival (wasted decode + extra surface churn).
	const decodeAhead = Math.max(3, Math.min(6, cacheMax - 1));

	return { cacheMax, holdoutMax, decodeAhead };
}
