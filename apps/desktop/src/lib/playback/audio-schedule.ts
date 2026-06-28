/**
 * Pure scheduling math for the Web Audio timeline engine (no `AudioContext`).
 *
 * The recording's audio covers the FULL original timeline. To play the EDITED
 * timeline we don't seek a media element around the cuts (fragile, drifts,
 * stalls); instead we schedule each KEPT region as its own `AudioBufferSourceNode`
 * on the audio clock, so the cuts become gaps in the schedule — sample-accurate
 * and silent by construction. Two pure steps:
 *   1. `keptRegions` — original-time intervals that survive (trim minus cuts),
 *      cut-bounded (NOT split by editor split points, which don't remove audio).
 *   2. `planAudioSchedule` — given those regions and the current OUTPUT time,
 *      map each to a `start(when, offset, duration)`.
 */

const EPS = 1e-4;

/** An interval on some timeline. */
export interface Region {
	/** Start (seconds). */
	start: number;
	/** End (seconds). */
	end: number;
}

/**
 * Kept original-time audio regions = `[inPoint, outPoint]` minus `cuts`. Cuts are
 * clipped to the trim range, merged, and removed; the surviving gaps are the regions.
 */
export function keptRegions(
	inPoint: number,
	outPoint: number,
	cuts: ReadonlyArray<Region>,
): Region[] {
	if (outPoint - inPoint <= EPS) return [];

	const clipped = cuts
		.map((c) => ({
			start: Math.max(inPoint, Math.min(c.start, c.end)),
			end: Math.min(outPoint, Math.max(c.start, c.end)),
		}))
		.filter((c) => c.end - c.start > EPS)
		.sort((a, b) => a.start - b.start);

	// Merge overlapping/adjacent cuts.
	const merged: Region[] = [];
	for (const c of clipped) {
		const last = merged[merged.length - 1];
		if (last && c.start <= last.end + EPS) last.end = Math.max(last.end, c.end);
		else merged.push({ ...c });
	}

	// The complement within [inPoint, outPoint] is the kept audio.
	const regions: Region[] = [];
	let cursor = inPoint;
	for (const c of merged) {
		if (c.start > cursor + EPS) regions.push({ start: cursor, end: c.start });
		cursor = Math.max(cursor, c.end);
	}
	if (outPoint > cursor + EPS) regions.push({ start: cursor, end: outPoint });
	return regions;
}

/** One scheduled audio chunk: play the buffer slice `[bufferOffset, +duration]`
 * starting `whenDelay` seconds from "now" (the moment scheduling begins). */
export interface ScheduledChunk {
	/** Seconds from now to begin this chunk (0 = immediately, mid-region). */
	whenDelay: number;
	/** Offset into the (original-time) audio buffer to start playing from. */
	bufferOffset: number;
	/** How long to play. */
	duration: number;
	/** Output-time span this chunk occupies (for resync/debugging). */
	outStart: number;
	outEnd: number;
}

/**
 * Plan the chunks to schedule so playback continues from OUTPUT time
 * `fromOutputTime`. Output time is gapless: region N starts where region N-1
 * ended. Regions already fully behind the playhead are skipped; the region the
 * playhead is inside starts immediately (`whenDelay` 0) at the right offset.
 */
export function planAudioSchedule(
	regions: ReadonlyArray<Region>,
	fromOutputTime: number,
): ScheduledChunk[] {
	const out: ScheduledChunk[] = [];
	let outCursor = 0;
	for (const region of regions) {
		const dur = region.end - region.start;
		if (dur <= EPS) continue;
		const outStart = outCursor;
		const outEnd = outCursor + dur;
		outCursor = outEnd;
		if (outEnd <= fromOutputTime + EPS) continue; // already played

		const intoRegion = Math.max(0, fromOutputTime - outStart);
		const whenDelay = Math.max(0, outStart - fromOutputTime);
		const duration = dur - intoRegion;
		if (duration <= EPS) continue;
		out.push({
			whenDelay,
			bufferOffset: region.start + intoRegion,
			duration,
			outStart,
			outEnd,
		});
	}
	return out;
}
