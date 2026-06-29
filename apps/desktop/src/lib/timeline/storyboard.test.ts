import { describe, expect, it } from "vitest";
import {
	planStoryboard,
	storyboardCellIndex,
	storyboardCrop,
	storyboardSampleSec,
	type StoryboardMeta,
} from "./storyboard";

describe("planStoryboard", () => {
	it("floors short clips at the minimum cell count", () => {
		expect(planStoryboard(3)).toEqual({ count: 40, cols: 10, rows: 4 });
		expect(planStoryboard(0)).toEqual({ count: 40, cols: 10, rows: 4 });
	});
	it("scales ~1 cell/sec in the mid range", () => {
		expect(planStoryboard(60)).toEqual({ count: 60, cols: 10, rows: 6 });
		expect(planStoryboard(95)).toEqual({ count: 95, cols: 10, rows: 10 });
	});
	it("caps very long clips at the maximum", () => {
		expect(planStoryboard(10_000)).toEqual({ count: 200, cols: 10, rows: 20 });
	});
	it("rounds the cell count up for fractional durations", () => {
		expect(planStoryboard(60.2).count).toBe(61);
	});
	it("rows always cover every cell", () => {
		for (const d of [3, 41, 60, 137, 200, 9999]) {
			const { count, cols, rows } = planStoryboard(d);
			expect(rows * cols).toBeGreaterThanOrEqual(count);
			expect((rows - 1) * cols).toBeLessThan(count);
		}
	});
});

describe("storyboardSampleSec", () => {
	it("samples the centre of each cell", () => {
		// 40 cells over 40s → cell 0 centres at 0.5s, cell 39 at 39.5s.
		expect(storyboardSampleSec(0, 40, 40)).toBeCloseTo(0.5);
		expect(storyboardSampleSec(39, 40, 40)).toBeCloseTo(39.5);
	});
	it("is monotonic and inside the clip", () => {
		const count = 50;
		let prev = -1;
		for (let c = 0; c < count; c++) {
			const t = storyboardSampleSec(c, count, 30);
			expect(t).toBeGreaterThan(prev);
			expect(t).toBeGreaterThan(0);
			expect(t).toBeLessThan(30);
			prev = t;
		}
	});
	it("guards a zero count", () => {
		expect(storyboardSampleSec(0, 0, 30)).toBe(0);
	});
});

describe("storyboardCellIndex", () => {
	it("maps a time to the covering cell", () => {
		// 40 cells over 40s → 1s per cell.
		expect(storyboardCellIndex(0, 40, 40)).toBe(0);
		expect(storyboardCellIndex(0.9, 40, 40)).toBe(0);
		expect(storyboardCellIndex(1, 40, 40)).toBe(1);
		expect(storyboardCellIndex(24.3, 40, 40)).toBe(24);
	});
	it("clamps past the ends", () => {
		expect(storyboardCellIndex(-5, 40, 40)).toBe(0);
		expect(storyboardCellIndex(40, 40, 40)).toBe(39);
		expect(storyboardCellIndex(999, 40, 40)).toBe(39);
	});
	it("guards non-positive count or duration", () => {
		expect(storyboardCellIndex(5, 0, 40)).toBe(0);
		expect(storyboardCellIndex(5, 40, 0)).toBe(0);
	});
});

describe("storyboardCrop", () => {
	const meta: StoryboardMeta = {
		cols: 10,
		rows: 4,
		cellW: 80,
		cellH: 48,
		count: 40,
		durationSec: 40,
	};

	it("scales a cell to the display height, preserving aspect", () => {
		const crop = storyboardCrop(meta, 0, 64);
		// dispW = 80/48 * 64
		expect(crop.dispW).toBeCloseTo((80 / 48) * 64);
		expect(crop.bgW).toBeCloseTo(10 * crop.dispW);
		expect(crop.bgH).toBe(4 * 64);
	});

	it("offsets to the cell covering the time (row-major)", () => {
		// 24s → cell 24 → col 4, row 2.
		const crop = storyboardCrop(meta, 24, 64);
		expect(crop.offX).toBeCloseTo(4 * crop.dispW);
		expect(crop.offY).toBe(2 * 64);
	});

	it("keeps the crop inside the sheet at the last cell", () => {
		const crop = storyboardCrop(meta, meta.durationSec, 64);
		expect(crop.offX + crop.dispW).toBeLessThanOrEqual(crop.bgW + 1e-6);
		expect(crop.offY + 64).toBeLessThanOrEqual(crop.bgH + 1e-6);
	});

	it("falls back to a square cell when cellH is missing", () => {
		const crop = storyboardCrop({ ...meta, cellH: 0 }, 0, 64);
		expect(crop.dispW).toBe(64);
	});
});
