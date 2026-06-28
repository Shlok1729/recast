/**
 * Pure maths for FocusPanel: the zoom scale at a given time (ramp-in → hold →
 * ramp-out), the sparkline path that visualises it, and the max ramp length for
 * a region. Extracted from the component so the curve maths is testable.
 */

import type { Easing } from "$lib/easing/cubic-bezier";
import type { ZoomRegion } from "$lib/stores/editor-store.svelte";

/** Longest a single ramp can be: half the region (so in+out can't overlap). */
export function regionMaxRamp(r: ZoomRegion): number {
	return Math.max(0, (r.end - r.start) * 0.5);
}

/**
 * Zoom scale at absolute time `t` for region `r`: 1 outside the region, ramping
 * up over `rampIn` (eased by `easeIn`), holding at `r.scale`, then ramping back
 * down over `rampOut` (eased by `easeOut`).
 */
export function scaleAt(r: ZoomRegion, t: number): number {
	if (t <= r.start || t >= r.end) return 1;
	const duration = Math.max(0, r.end - r.start);
	const half = duration * 0.5;
	const rampIn = Math.min(Math.max(0, r.rampIn), half);
	const rampOut = Math.min(Math.max(0, r.rampOut), half);
	const holdStart = r.start + rampIn;
	const holdEnd = r.end - rampOut;
	let phase: number;
	let curve: Easing;
	if (t < holdStart) {
		phase = rampIn > 0 ? (t - r.start) / rampIn : 1;
		curve = r.easeIn;
	} else if (t > holdEnd) {
		phase = rampOut > 0 ? (r.end - t) / rampOut : 1;
		curve = r.easeOut;
	} else {
		return r.scale;
	}
	phase = Math.max(0, Math.min(1, phase));
	// Low-budget x→y approximation (polynomial-in-t with t ≈ x). Indistinguishable
	// at sparkline resolution; avoids pulling in the full Newton-Raphson solver.
	const a = 1 - 3 * curve.y2 + 3 * curve.y1;
	const b = 3 * curve.y2 - 6 * curve.y1;
	const c = 3 * curve.y1;
	const s = ((a * phase + b) * phase + c) * phase;
	return 1 + (r.scale - 1) * s;
}

/**
 * SVG path for a region's zoom envelope across a `w × h` box — a normalised
 * 1.0 → scale → 1.0 curve sampled at 41 points.
 */
export function sparklinePath(r: ZoomRegion, w: number, h: number): string {
	const duration = Math.max(0.001, r.end - r.start);
	const maxScale = Math.max(r.scale, 1.0);
	const normScale = (s: number) =>
		maxScale === 1 ? 1 : (s - 1) / (maxScale - 1);
	const samples: Array<[number, number]> = [];
	const N = 40;
	for (let i = 0; i <= N; i++) {
		const t = (i / N) * duration;
		const absT = r.start + t;
		const s = scaleAt(r, absT);
		const x = (t / duration) * w;
		const y = h - normScale(s) * h * 0.9 - 1;
		samples.push([x, y]);
	}
	return samples
		.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
		.join(" ");
}
