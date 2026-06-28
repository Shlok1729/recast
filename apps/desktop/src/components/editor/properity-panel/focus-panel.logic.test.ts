import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "$lib/stores/editor-store.svelte";
import { regionMaxRamp, scaleAt, sparklinePath } from "./focus-panel.logic";

const linear = { x1: 0, y1: 0, x2: 1, y2: 1 };
function region(over: Partial<ZoomRegion> = {}): ZoomRegion {
	return {
		start: 0,
		end: 10,
		scale: 2,
		rampIn: 2,
		rampOut: 2,
		easeIn: linear,
		easeOut: linear,
		...over,
	} as unknown as ZoomRegion;
}

describe("regionMaxRamp", () => {
	it("is half the region duration", () => {
		expect(regionMaxRamp(region({ start: 0, end: 10 }))).toBe(5);
		expect(regionMaxRamp(region({ start: 4, end: 4 }))).toBe(0);
	});
});

describe("scaleAt", () => {
	const r = region();
	it("is 1 outside the region", () => {
		expect(scaleAt(r, -1)).toBe(1);
		expect(scaleAt(r, 0)).toBe(1);
		expect(scaleAt(r, 10)).toBe(1);
		expect(scaleAt(r, 99)).toBe(1);
	});
	it("holds at full scale between the ramps", () => {
		// rampIn 2 → holdStart 2; rampOut 2 → holdEnd 8
		expect(scaleAt(r, 5)).toBe(2);
		expect(scaleAt(r, 2)).toBe(2);
	});
	it("rises from 1 toward scale during ramp-in (linear easing)", () => {
		// halfway through a linear ramp-in → scale 1.5
		expect(scaleAt(r, 1)).toBeCloseTo(1.5, 5);
	});
});

describe("sparklinePath", () => {
	it("emits a moveto then 40 linetos across the width", () => {
		const path = sparklinePath(region(), 100, 20);
		expect(path.startsWith("M ")).toBe(true);
		expect((path.match(/L /g) ?? []).length).toBe(40);
		expect(path).toContain("100.00"); // last sample reaches full width
	});
});
