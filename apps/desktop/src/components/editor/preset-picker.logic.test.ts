import { describe, expect, it } from "vitest";
import {
	aspectClass,
	bgPreviewStyle,
	frameInsetPct,
	score,
	wallpaperId,
} from "./preset-picker.logic";

const preset = {
	label: "Studio",
	category: "Studio",
	aspect: "16:9",
	description: "Soft blue gradient",
	keywords: ["clean", "demo"],
	bg: "gradient",
	value: "linear-gradient(#000,#fff)",
};

describe("score", () => {
	it("matches everything on an empty query", () => {
		expect(score(preset, "")).toBe(1);
	});
	it("ranks label prefix above substring and keyword", () => {
		expect(score(preset, "stu")).toBe(100);
		// label substring (90/category-prefix excluded by a non-matching category)
		expect(
			score({ ...preset, label: "My Studio", category: "Other" }, "studio"),
		).toBe(80);
		expect(score({ ...preset, label: "X", category: "Y" }, "demo")).toBe(30);
	});
	it("returns 0 for no match", () => {
		expect(score({ ...preset, keywords: [], description: "" }, "zzz")).toBe(0);
	});
});

describe("frameInsetPct", () => {
	it("is 0 at no padding and capped at 20", () => {
		expect(frameInsetPct(0)).toBe(0);
		expect(frameInsetPct(10_000)).toBe(20);
	});
	it("mirrors video occupancy 1/(1+2p)", () => {
		// padding 50% → p=0.5 → 0.5/2 = 25% → capped to 20
		expect(frameInsetPct(50)).toBe(20);
		// padding 10% → p=0.1 → 0.1/1.2 ≈ 8.33%
		expect(frameInsetPct(10)).toBeCloseTo(8.333, 2);
	});
});

describe("aspectClass", () => {
	it("maps known aspects, defaults to video", () => {
		expect(aspectClass("1:1")).toBe("aspect-square");
		expect(aspectClass("9:16")).toBe("aspect-[9/16]");
		expect(aspectClass("weird")).toBe("aspect-video");
	});
});

describe("wallpaperId", () => {
	it("strips asset prefixes", () => {
		expect(wallpaperId({ ...preset, value: "asset://abc" })).toBe("abc");
		expect(wallpaperId({ ...preset, value: "asset:xyz" })).toBe("xyz");
	});
});

describe("bgPreviewStyle", () => {
	it("uses the value for gradient/color, muted otherwise", () => {
		expect(bgPreviewStyle(preset)).toBe(
			"background:linear-gradient(#000,#fff)",
		);
		expect(bgPreviewStyle({ ...preset, bg: "wallpaper" })).toBe(
			"background:var(--color-muted)",
		);
	});
});
