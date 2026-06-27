import { describe, expect, it } from "vitest";
import {
	buildSampleTable,
	chooseIngestion,
	gopByteRange,
	PROGRESSIVE_THRESHOLD_BYTES,
	type RawSampleTables,
} from "./mp4-sample-table";

/**
 * A 6-sample, 2-chunk fixture (3 samples per chunk), 10fps at timescale 1000.
 * Variable sizes so byte offsets are non-trivial; keyframes at samples 1 and 4
 * (1-based) i.e. decode-indices 0 and 3.
 *
 *   chunk 1 @ byte 1000: s0(500) s1(200) s2(300)  → offsets 1000,1500,1700
 *   chunk 2 @ byte 4000: s3(400) s4(100) s5(250)  → offsets 4000,4400,4500
 */
const FIXTURE: RawSampleTables = {
	sampleSizes: [500, 200, 300, 400, 100, 250],
	sampleSizeConstant: 0,
	sampleCount: 6,
	chunkOffsets: [1000, 4000],
	stscFirstChunk: [1],
	stscSamplesPerChunk: [3],
	sttsCounts: [6],
	sttsDeltas: [100],
	stssSampleNumbers: [1, 4],
	timescale: 1000,
};

describe("buildSampleTable", () => {
	it("maps sizes, byte offsets, timing and sync flags from the stbl arrays", () => {
		const t = buildSampleTable(FIXTURE);
		expect(t).toHaveLength(6);
		expect(t.map((s) => s.offset)).toEqual([1000, 1500, 1700, 4000, 4400, 4500]);
		expect(t.map((s) => s.size)).toEqual([500, 200, 300, 400, 100, 250]);
		expect(t.map((s) => s.ctsUs)).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
		expect(t.every((s) => s.durUs === 100_000)).toBe(true);
		expect(t.map((s) => s.key)).toEqual([true, false, false, true, false, false]);
	});

	it("treats every sample as a keyframe when there is no stss table", () => {
		const t = buildSampleTable({ ...FIXTURE, stssSampleNumbers: undefined });
		expect(t.every((s) => s.key)).toBe(true);
	});

	it("supports a constant sample size (empty stsz.sample_sizes)", () => {
		const t = buildSampleTable({
			sampleSizes: [],
			sampleSizeConstant: 1000,
			sampleCount: 4,
			chunkOffsets: [5000],
			stscFirstChunk: [1],
			stscSamplesPerChunk: [4],
			sttsCounts: [4],
			sttsDeltas: [100],
			timescale: 1000,
		});
		expect(t.map((s) => s.offset)).toEqual([5000, 6000, 7000, 8000]);
		expect(t.every((s) => s.size === 1000)).toBe(true);
	});

	it("applies ctts composition offsets (B-frame reordering) to cts", () => {
		// dts = 0,100,200,300 ; ctts offsets (run-length [1,1,2]→[0,300,100,100])
		// ⇒ cts = 0,400,300,400.
		const t = buildSampleTable({
			sampleSizes: [10, 10, 10, 10],
			sampleSizeConstant: 0,
			sampleCount: 4,
			chunkOffsets: [0],
			stscFirstChunk: [1],
			stscSamplesPerChunk: [4],
			sttsCounts: [4],
			sttsDeltas: [100],
			cttsCounts: [1, 1, 2],
			cttsOffsets: [0, 300, 100],
			timescale: 1000,
		});
		expect(t.map((s) => s.ctsUs)).toEqual([0, 400_000, 300_000, 400_000]);
	});

	it("returns [] for an empty or malformed table", () => {
		expect(buildSampleTable({ ...FIXTURE, sampleCount: 0 })).toEqual([]);
		expect(buildSampleTable({ ...FIXTURE, chunkOffsets: [] })).toEqual([]);
		// Chunks cover only 3 samples but sampleCount claims 6 → bail.
		expect(
			buildSampleTable({ ...FIXTURE, chunkOffsets: [1000], stscFirstChunk: [1], stscSamplesPerChunk: [3] }),
		).toEqual([]);
	});
});

describe("gopByteRange", () => {
	const samples = buildSampleTable(FIXTURE);
	const keyframes = [0, 3];

	it("covers the first GOP from its keyframe to just before the next", () => {
		// s0..s2: bytes 1000..(1700+300)=2000 → inclusive 1000..1999.
		expect(gopByteRange(samples, keyframes, 0)).toEqual({ startByte: 1000, endByte: 1999 });
	});

	it("covers the last GOP through end of stream", () => {
		// s3..s5: bytes 4000..(4500+250)=4750 → inclusive 4000..4749.
		expect(gopByteRange(samples, keyframes, 3)).toEqual({ startByte: 4000, endByte: 4749 });
	});
});

describe("chooseIngestion", () => {
	it("uses whole-file below the threshold and progressive at/above it", () => {
		expect(chooseIngestion(10 * 1024 * 1024)).toBe("whole");
		expect(chooseIngestion(PROGRESSIVE_THRESHOLD_BYTES)).toBe("progressive");
		expect(chooseIngestion(PROGRESSIVE_THRESHOLD_BYTES + 1)).toBe("progressive");
	});

	it("falls back to whole-file when the size is unknown or invalid", () => {
		expect(chooseIngestion(undefined)).toBe("whole");
		expect(chooseIngestion(0)).toBe("whole");
		expect(chooseIngestion(Number.NaN)).toBe("whole");
	});

	it("honours a custom threshold", () => {
		expect(chooseIngestion(50 * 1024 * 1024, 20 * 1024 * 1024)).toBe("progressive");
	});
});
