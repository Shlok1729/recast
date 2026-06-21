/**
 * Frame-index logic for the WebCodecs video source — the pure, decoder-free
 * half of decode scheduling, split out so it can be unit-tested without a real
 * `VideoDecoder` or a real MP4.
 *
 * The index is the demuxed sample table in two orders:
 *   - `chunks`     — encoded samples in DECODE order (how they're fed to the
 *                    decoder; the order mp4box emits them).
 *   - `presOrder`  — indices into `chunks` sorted by presentation time (cts),
 *                    used to answer "which frame is on screen at time T".
 * Keyframes are decode-order indices of sync samples (valid decode entry
 * points). All times are microseconds.
 */

/** One encoded frame, in DECODE order, with its presentation time. */
export interface ChunkMeta {
	/** Presentation timestamp (µs) — the cache key and frameAt lookup key. */
	ctsUs: number;
	/** Duration (µs). */
	durUs: number;
	/** IDR / sync sample — a valid decode entry point. */
	key: boolean;
	/** Encoded bytes (avcC length-prefixed NAL units). */
	data: Uint8Array;
}

/** Decode-order indices of keyframes, ascending. */
export function buildKeyframes(chunks: ReadonlyArray<ChunkMeta>): number[] {
	const out: number[] = [];
	for (let i = 0; i < chunks.length; i++) if (chunks[i].key) out.push(i);
	return out;
}

/** Indices into `chunks` sorted by presentation time (cts ascending). */
export function buildPresOrder(chunks: ReadonlyArray<ChunkMeta>): number[] {
	return chunks
		.map((_, i) => i)
		.sort((a, b) => chunks[a].ctsUs - chunks[b].ctsUs);
}

/**
 * Decode-index of the last sample whose presentation time is ≤ `tUs`. Returns
 * the earliest sample when `tUs` precedes everything (so the screen is never
 * blank). Assumes `presOrder` is non-empty.
 */
export function sampleAtOrBefore(
	chunks: ReadonlyArray<ChunkMeta>,
	presOrder: ReadonlyArray<number>,
	tUs: number,
): number {
	let lo = 0;
	let hi = presOrder.length - 1;
	let ans = presOrder[0];
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (chunks[presOrder[mid]].ctsUs <= tUs) {
			ans = presOrder[mid];
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return ans;
}

/** Largest keyframe decode-index ≤ `decodeIndex`. Assumes a keyframe at 0. */
export function keyframeAtOrBefore(
	keyframes: ReadonlyArray<number>,
	decodeIndex: number,
): number {
	let lo = 0;
	let hi = keyframes.length - 1;
	let ans = keyframes[0] ?? 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (keyframes[mid] <= decodeIndex) {
			ans = keyframes[mid];
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return ans;
}

/**
 * Whether the decoder must be reset+reconfigured before feeding the GOP at
 * keyframe `kf`, given the keyframe it's currently primed from (`anchorKey`,
 * -1 if never primed) and the next decode-index it would feed (`feedCursor`).
 *
 * A fresh GOP is needed when we've never primed, jumped BACKWARD to an earlier
 * keyframe, or there's a gap — the target GOP starts past where we've fed, i.e.
 * a forward jump across a cut. Continuous forward playback hits none of these,
 * so it never resets and frames just keep streaming.
 */
export function needsReset(
	anchorKey: number,
	feedCursor: number,
	kf: number,
): boolean {
	return anchorKey === -1 || kf < anchorKey || kf > feedCursor;
}
