import { describe, expect, it } from "vitest";
import {
	cutContaining,
	normalizeCuts,
	originalToOutput,
	outputToOriginal,
	overlapsAny,
	totalCutDuration,
	type TimelineCut,
} from "./cuts";

function cut(start: number, end: number, id = `${start}-${end}`): TimelineCut {
	return { id, start, end, source: "manual" };
}

describe("normalizeCuts", () => {
	it("sorts cuts by start", () => {
		const out = normalizeCuts([cut(6, 7), cut(1, 2)]);
		expect(out.map((c) => c.start)).toEqual([1, 6]);
	});

	it("drops zero-length and inverted ranges", () => {
		expect(normalizeCuts([cut(2, 2), cut(5, 4)])).toEqual([]);
	});

	it("merges overlapping ranges", () => {
		const out = normalizeCuts([cut(1, 4), cut(3, 6)]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ start: 1, end: 6 });
	});

	it("merges touching ranges", () => {
		const out = normalizeCuts([cut(1, 3), cut(3, 5)]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ start: 1, end: 5 });
	});

	it("leaves disjoint ranges separate", () => {
		expect(normalizeCuts([cut(1, 2), cut(4, 5)])).toHaveLength(2);
	});
});

describe("totalCutDuration", () => {
	it("sums disjoint cuts", () => {
		expect(totalCutDuration([cut(1, 2), cut(4, 6)])).toBeCloseTo(3);
	});

	it("counts merged overlap only once", () => {
		expect(totalCutDuration([cut(1, 4), cut(3, 6)])).toBeCloseTo(5);
	});
});

describe("cutContaining", () => {
	const cuts = [cut(2, 4)];
	it("finds a cut for an interior time", () => {
		expect(cutContaining(cuts, 3)?.start).toBe(2);
	});
	it("is start-inclusive and end-exclusive", () => {
		expect(cutContaining(cuts, 2)).not.toBeNull();
		expect(cutContaining(cuts, 4)).toBeNull();
	});
	it("returns null for a kept time", () => {
		expect(cutContaining(cuts, 5)).toBeNull();
	});
});

describe("originalToOutput / outputToOriginal", () => {
	const cuts = [cut(2, 4), cut(7, 8)]; // 3s removed total

	it("is identity before any cut", () => {
		expect(originalToOutput(cuts, 1)).toBeCloseTo(1);
	});

	it("collapses a time inside a cut onto the cut start", () => {
		expect(originalToOutput(cuts, 3)).toBeCloseTo(2);
	});

	it("subtracts removed time after a cut", () => {
		// 5 is past the [2,4] cut (2s removed) → 3.
		expect(originalToOutput(cuts, 5)).toBeCloseTo(3);
		// 9 is past both cuts (3s removed) → 6.
		expect(originalToOutput(cuts, 9)).toBeCloseTo(6);
	});

	it("round-trips kept times through outputToOriginal", () => {
		for (const t of [1, 5, 6, 9]) {
			expect(outputToOriginal(cuts, originalToOutput(cuts, t))).toBeCloseTo(t);
		}
	});
});

describe("overlapsAny", () => {
	const ranges = [{ start: 2, end: 4 }];
	it("detects an overlap", () => {
		expect(overlapsAny(ranges, 3, 5)).toBe(true);
	});
	it("treats edge-touching as non-overlapping", () => {
		expect(overlapsAny(ranges, 4, 6)).toBe(false);
		expect(overlapsAny(ranges, 0, 2)).toBe(false);
	});
	it("returns false when clear", () => {
		expect(overlapsAny(ranges, 5, 6)).toBe(false);
	});
});
