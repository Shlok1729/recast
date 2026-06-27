import { describe, expect, it } from "vitest";
import { GopByteBudget } from "./gop-byte-budget";

describe("GopByteBudget", () => {
	it("tracks residency and total bytes", () => {
		const b = new GopByteBudget(1000);
		expect(b.touch(0, 300)).toEqual([]);
		expect(b.touch(1, 200)).toEqual([]);
		expect(b.has(0)).toBe(true);
		expect(b.has(2)).toBe(false);
		expect(b.totalBytes).toBe(500);
		expect(b.size).toBe(2);
	});

	it("evicts least-recently-used GOPs when over budget", () => {
		const b = new GopByteBudget(500);
		b.touch(0, 200);
		b.touch(1, 200);
		// Adding 200 (total 600 > 500) evicts the LRU = key 0.
		expect(b.touch(2, 200)).toEqual([0]);
		expect(b.has(0)).toBe(false);
		expect(b.has(1)).toBe(true);
		expect(b.has(2)).toBe(true);
		expect(b.totalBytes).toBe(400);
	});

	it("treats touch as a recency bump (re-touched GOP survives)", () => {
		const b = new GopByteBudget(500);
		b.touch(0, 200);
		b.touch(1, 200);
		b.touch(0, 200); // refresh 0 → now 1 is the LRU
		expect(b.touch(2, 200)).toEqual([1]);
		expect(b.has(0)).toBe(true);
		expect(b.has(1)).toBe(false);
	});

	it("never evicts the just-touched GOP, even if it alone exceeds budget", () => {
		const b = new GopByteBudget(100);
		expect(b.touch(0, 250)).toEqual([]); // can't evict itself
		expect(b.has(0)).toBe(true);
		expect(b.totalBytes).toBe(250);
	});

	it("never evicts a protected GOP (the one on screen)", () => {
		const b = new GopByteBudget(500);
		b.touch(5, 200); // display GOP
		b.touch(6, 200);
		// Adding 200 would evict LRU=5, but 5 is protected → evict 6 instead.
		expect(b.touch(7, 200, 5)).toEqual([6]);
		expect(b.has(5)).toBe(true);
		expect(b.has(7)).toBe(true);
	});

	it("supports explicit delete and clear", () => {
		const b = new GopByteBudget(1000);
		b.touch(0, 300);
		b.touch(1, 400);
		b.delete(0);
		expect(b.has(0)).toBe(false);
		expect(b.totalBytes).toBe(400);
		b.clear();
		expect(b.size).toBe(0);
		expect(b.totalBytes).toBe(0);
	});
});
