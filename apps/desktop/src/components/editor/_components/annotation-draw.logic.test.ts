import { describe, expect, it } from "vitest";
import {
	arrowGeometry,
	blurTint,
	strokeDashPattern,
} from "./annotation-draw.logic";

describe("strokeDashPattern", () => {
	it("scales dash arrays by stroke width; solid is empty", () => {
		expect(strokeDashPattern("solid", 2)).toEqual([]);
		expect(strokeDashPattern(undefined, 2)).toEqual([]);
		expect(strokeDashPattern("dashed", 2)).toEqual([16, 12]);
		expect(strokeDashPattern("dotted", 3)).toEqual([6, 12]);
	});
});

describe("blurTint", () => {
	it("returns fixed tints for white/black", () => {
		expect(blurTint("white", "")).toBe("rgba(255,255,255,0.30)");
		expect(blurTint("black", "")).toBe("rgba(0,0,0,0.30)");
	});
	it("parses a #rrggbb colour variant", () => {
		expect(blurTint("color", "#ff8000")).toBe("rgba(255,128,0,0.30)");
		expect(blurTint("color", "00ff00")).toBe("rgba(0,255,0,0.30)");
	});
	it("returns null for no-tint or invalid colour", () => {
		expect(blurTint("none", "")).toBeNull();
		expect(blurTint("color", "nope")).toBeNull();
	});
});

describe("arrowGeometry", () => {
	it("is null for a degenerate arrow", () => {
		expect(arrowGeometry({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 2, 0.2)).toBeNull();
	});
	it("computes shaft end and symmetric head corners", () => {
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 0.2)!;
		// len 100, headLen max(4, 20)=20, headWidth 14
		expect(g.tip).toEqual({ x: 100, y: 0 });
		expect(g.lineEnd.x).toBeCloseTo(80, 5);
		expect(g.left.y).toBeCloseTo(7, 5);
		expect(g.right.y).toBeCloseTo(-7, 5);
	});
	it("respects the stroke-width floor on head length", () => {
		// tiny headSize → headLen floored at strokePx*2 = 20
		const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 0.01)!;
		expect(g.lineEnd.x).toBeCloseTo(80, 5);
	});
});
