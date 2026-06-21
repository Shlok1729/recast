/**
 * PlaybackClock — the master timeline clock for the editor preview.
 *
 * Today the muted `<video>` element is the source of truth for "what time is
 * it": audio elements, the scrubber, loop, and frame-stepping all read
 * `videoEl.currentTime`. That couples the clock to the browser's video decoder,
 * whose seek latency is exactly what makes playback freeze at a cut boundary.
 *
 * This clock decouples the two. It is a pure real-time *integrator*: when
 * playing, `time` advances with wall-clock at `rate`; when paused it holds.
 * Nothing decodes here — the render loop samples `time` each frame and asks the
 * video source for the matching frame, and the audio elements slave to it. The
 * clock has no knowledge of cuts or trims; it runs over a single monotonic,
 * gapless **output-time** domain `[0, duration]` (the recording with cuts
 * removed — see ./timeline/cuts.ts). The owner maps output→original time with
 * `outputToOriginal` for the one place that still needs original media time
 * (frame lookup, cursor/zoom eval, audio `currentTime`).
 *
 * Because reading `time` is a function of `now()` rather than a ticked
 * counter, sampling it from a 120 Hz rAF loop is exact and cheap, and the clock
 * never drifts relative to wall-clock. `now` is injectable so the integrator
 * logic is unit-testable without real time.
 */

/** Monotonic millisecond time source. Defaults to `performance.now`. */
export type NowFn = () => number;

const defaultNow: NowFn = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

export class PlaybackClock {
	#now: NowFn;
	// Anchor: at wall-clock `#anchorWallMs`, playback time was `#anchorTime`.
	// While playing, current time = anchorTime + (now - anchorWall)/1000 * rate.
	#anchorWallMs: number;
	#anchorTime: number;
	#playing = false;
	#rate = 1;
	#duration = 0;

	constructor(now: NowFn = defaultNow) {
		this.#now = now;
		this.#anchorWallMs = now();
		this.#anchorTime = 0;
	}

	/** Re-anchor so that, from this instant, `time` continues from `t`. */
	#reanchor(t: number): void {
		this.#anchorWallMs = this.#now();
		this.#anchorTime = this.#clamp(t);
	}

	#clamp(t: number): number {
		if (!(t > 0)) return 0; // also catches NaN
		if (t > this.#duration) return this.#duration;
		return t;
	}

	/** Current playback position in output-time seconds, clamped to [0, duration]. */
	get time(): number {
		if (!this.#playing) return this.#anchorTime;
		const elapsedSec = ((this.#now() - this.#anchorWallMs) / 1000) * this.#rate;
		return this.#clamp(this.#anchorTime + elapsedSec);
	}

	get playing(): boolean {
		return this.#playing;
	}

	get rate(): number {
		return this.#rate;
	}

	get duration(): number {
		return this.#duration;
	}

	/** True once playback has reached the end of the output domain. */
	get atEnd(): boolean {
		return this.#duration > 0 && this.time >= this.#duration - 1e-6;
	}

	/**
	 * Set the output duration. Re-anchors first so a duration change mid-playback
	 * doesn't retroactively move the current time; the new value re-clamps it.
	 */
	setDuration(duration: number): void {
		this.#reanchor(this.time);
		this.#duration = duration > 0 ? duration : 0;
		this.#anchorTime = this.#clamp(this.#anchorTime);
	}

	play(): void {
		if (this.#playing) return;
		// Starting from the end is a no-op rather than an instant stall.
		this.#reanchor(this.time);
		this.#playing = true;
	}

	pause(): void {
		if (!this.#playing) return;
		// Freeze at the current computed time.
		this.#anchorTime = this.time;
		this.#playing = false;
	}

	/** Jump to output time `t` (clamped). Preserves play/pause state. */
	seek(t: number): void {
		this.#reanchor(t);
	}

	/** Set playback rate (e.g. 0.5, 2). Re-anchors so the change is seamless. */
	setRate(rate: number): void {
		if (!(rate > 0)) return;
		this.#reanchor(this.time);
		this.#rate = rate;
	}
}
