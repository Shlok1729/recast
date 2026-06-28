import { describe, expect, it } from "vitest";
import { clock, clockCentis, clockDecis, compactDuration } from "./time";

describe("clock (M:SS)", () => {
	it("formats minutes and zero-padded seconds", () => {
		expect(clock(0)).toBe("0:00");
		expect(clock(5)).toBe("0:05");
		expect(clock(65)).toBe("1:05");
		expect(clock(600)).toBe("10:00");
	});
	it("clamps negatives and non-finite to zero", () => {
		expect(clock(-3)).toBe("0:00");
		expect(clock(NaN)).toBe("0:00");
		expect(clock(Infinity)).toBe("0:00");
	});
});

describe("clockCentis (M:SS.cc)", () => {
	it("truncates centiseconds", () => {
		expect(clockCentis(0)).toBe("0:00.00");
		expect(clockCentis(5.239)).toBe("0:05.23");
		expect(clockCentis(65.5)).toBe("1:05.50");
	});
	it("renders zero for non-finite (the old ExportDialog guard)", () => {
		expect(clockCentis(NaN)).toBe("0:00.00");
		expect(clockCentis(-1)).toBe("0:00.00");
	});
});

describe("clockDecis (M:SS.d)", () => {
	it("formats one decimal of seconds, zero-padded", () => {
		expect(clockDecis(5.24)).toBe("0:05.2");
		expect(clockDecis(65)).toBe("1:05.0");
	});
});

describe("compactDuration", () => {
	it("uses seconds at/above 1s and ms below", () => {
		expect(compactDuration(1.5)).toBe("1.5s");
		expect(compactDuration(0.5)).toBe("500ms");
		expect(compactDuration(0.04)).toBe("40ms");
	});
});
