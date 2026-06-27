import { describe, expect, it } from "vitest";
import { keptRegions, planAudioSchedule } from "./audio-schedule";

describe("keptRegions", () => {
	it("returns the whole trim range when there are no cuts", () => {
		expect(keptRegions(0, 10, [])).toEqual([{ start: 0, end: 10 }]);
	});

	it("removes a single interior cut, leaving two regions", () => {
		expect(keptRegions(0, 10, [{ start: 3, end: 5 }])).toEqual([
			{ start: 0, end: 3 },
			{ start: 5, end: 10 },
		]);
	});

	it("clips cuts to the trim range", () => {
		expect(keptRegions(2, 8, [{ start: 0, end: 3 }, { start: 7, end: 12 }])).toEqual([
			{ start: 3, end: 7 },
		]);
	});

	it("merges overlapping/adjacent cuts", () => {
		expect(
			keptRegions(0, 10, [
				{ start: 3, end: 5 },
				{ start: 4, end: 6 },
			]),
		).toEqual([
			{ start: 0, end: 3 },
			{ start: 6, end: 10 },
		]);
	});

	it("returns [] when the whole range is cut", () => {
		expect(keptRegions(0, 10, [{ start: 0, end: 10 }])).toEqual([]);
		expect(keptRegions(5, 5, [])).toEqual([]);
	});
});

describe("planAudioSchedule", () => {
	// Two kept regions: [0,3] orig (output 0–3) and [5,10] orig (output 3–8).
	const regions = [
		{ start: 0, end: 3 },
		{ start: 5, end: 10 },
	];

	it("schedules every region from the start of playback", () => {
		const plan = planAudioSchedule(regions, 0);
		expect(plan).toEqual([
			{ whenDelay: 0, bufferOffset: 0, duration: 3, outStart: 0, outEnd: 3 },
			{ whenDelay: 3, bufferOffset: 5, duration: 5, outStart: 3, outEnd: 8 },
		]);
	});

	it("starts mid-region immediately at the right buffer offset", () => {
		// Output time 4 is 1s into the second region (orig 5..10) → buffer offset 6.
		const plan = planAudioSchedule(regions, 4);
		expect(plan).toEqual([
			{ whenDelay: 0, bufferOffset: 6, duration: 4, outStart: 3, outEnd: 8 },
		]);
	});

	it("skips regions fully behind the playhead", () => {
		const plan = planAudioSchedule(regions, 3.5);
		expect(plan).toHaveLength(1);
		expect(plan[0].outStart).toBe(3);
	});

	it("maps output time across a cut to the post-cut buffer offset", () => {
		// Output 3 is exactly the cut boundary → second region starts now at orig 5.
		const plan = planAudioSchedule(regions, 3);
		expect(plan[0]).toMatchObject({ whenDelay: 0, bufferOffset: 5, duration: 5 });
	});

	it("returns nothing once playback is past the end", () => {
		expect(planAudioSchedule(regions, 8)).toEqual([]);
	});
});
