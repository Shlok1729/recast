/**
 * WebCodecsVideoSource — frame-accurate video decode for the editor preview.
 *
 * This is the piece that fixes "playback freezes at a cut". The old preview
 * used an HTML `<video>` element as its frame source, so jumping over a cut
 * meant `video.currentTime = cut.end` — a native seek whose latency (decode
 * from the nearest keyframe) is the visible stall. We can't control that seek.
 *
 * Here we own the decode pipeline instead, the way Cap does in Rust:
 *   - mp4box.js demuxes the recording into encoded H.264 samples + the avcC
 *     config, with a presentation-time index.
 *   - a WebCodecs `VideoDecoder` decodes on demand into `VideoFrame`s, which
 *     WebGL can upload directly (`texImage2D(..., videoFrame)`), same as a
 *     `<video>` element but without the element.
 *   - decoded frames live in a bounded cache (cf. Cap's 90-frame cache) so the
 *     frames around the playhead — and across an upcoming cut — are already in
 *     memory. A "seek" becomes a cache lookup + a short decode from the
 *     keyframe, scheduled ahead of time, not a black-box stall.
 *
 * Threading: the demux, decoder, and decode-ahead scheduling all run in a
 * dedicated worker (`webcodecs-worker.ts`). This class is the main-thread
 * proxy — it owns the bounded decoded-frame cache (frames are transferred from
 * the worker) and answers the render loop synchronously, while telling the
 * worker where the playhead is so it can decode ahead. That keeps the WebView
 * main thread doing only the cheap work: the cache lookup + the WebGL upload.
 *
 * Ownership: `frameAt()` returns a frame owned by the cache. The caller uploads
 * it synchronously and must NOT close it. Frames are closed on eviction and on
 * `dispose()`. `VideoFrame`s are GPU-backed and refcounted — leaking them
 * exhausts the decoder, so every cached frame has exactly one close path.
 */

import type { FromWorker, ToWorker } from "./webcodecs-protocol";

/** Decoded-frame cache window around the playhead, in seconds. */
const BACK_WINDOW_S = 0.1;
const FWD_WINDOW_S = 0.3;
/**
 * Hard cap on cached frames. Kept SMALL on purpose: each held VideoFrame keeps
 * one of the hardware decoder's limited output surfaces checked out, and
 * holding too many starves that pool so the decoder stalls (processes input but
 * can't emit). A handful is enough for the playhead + a little lookahead.
 */
const MAX_CACHED_FRAMES = 5;

export class WebCodecsVideoSource {
	#worker: Worker;
	/** Decoded frames, keyed by ctsUs. */
	#cache = new Map<number, VideoFrame>();
	/** Last requested presentation time (µs) — drives eviction. */
	#currentUs = 0;
	#disposed = false;

	readonly width: number;
	readonly height: number;
	readonly durationSec: number;
	readonly fps: number;

	/**
	 * Called after a newly-decoded frame lands in the cache. The render loop is
	 * driven by playback, so while PAUSED (a scrub) nothing would repaint when
	 * the worker finishes decoding the seeked-to frame — wire this to a redraw.
	 */
	onFrame: (() => void) | null = null;

	// DIAGNOSTICS (temporary): throughput + first-frame geometry, to pin down the
	// "video updates ~0.5fps / half-center render" reports. Logged to the console
	// only while the engine runs. Remove once the pipeline is validated.
	#framesSeen = 0;
	#lastLogMs = 0;
	#loggedDims = false;

	private constructor(
		worker: Worker,
		meta: { width: number; height: number; durationSec: number; fps: number },
	) {
		this.#worker = worker;
		this.width = meta.width;
		this.height = meta.height;
		this.durationSec = meta.durationSec;
		this.fps = meta.fps;
		// Take over message handling for the steady state (frames + late errors).
		this.#worker.onmessage = (e: MessageEvent<FromWorker>) =>
			this.#onMessage(e.data);
	}

	/**
	 * Spawn the decode worker, demux `url`, and resolve once the source can
	 * answer `frameAt`. Rejects if the file has no decodable video track or the
	 * codec/WebView isn't supported by WebCodecs — the caller should fall back
	 * to the `<video>` path.
	 */
	static async create(url: string): Promise<WebCodecsVideoSource> {
		if (typeof Worker === "undefined" || typeof VideoFrame === "undefined") {
			throw new Error("WebCodecs/Worker unavailable in this WebView");
		}
		// Fetch the file on the main thread — the Tauri asset protocol is reliably
		// reachable here — then transfer the bytes into the worker.
		const res = await fetch(url);
		if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
		const buffer = await res.arrayBuffer();

		const worker = new Worker(
			new URL("./webcodecs-worker.ts", import.meta.url),
			{ type: "module" },
		);
		try {
			const meta = await new Promise<{
				width: number;
				height: number;
				durationSec: number;
				fps: number;
			}>((resolve, reject) => {
				worker.onmessage = (e: MessageEvent<FromWorker>) => {
					const msg = e.data;
					if (msg.type === "ready") {
						resolve(msg);
					} else if (msg.type === "error") {
						reject(new Error(msg.message));
					} else if (msg.type === "frame") {
						// A frame arriving before `ready` shouldn't happen; don't leak it.
						msg.frame.close();
					}
				};
				worker.onerror = (e) => reject(new Error(e.message || "worker error"));
				worker.postMessage({ type: "init", buffer } satisfies ToWorker, [
					buffer,
				]);
			});
			return new WebCodecsVideoSource(worker, meta);
		} catch (err) {
			worker.terminate();
			throw err;
		}
	}

	#post(msg: ToWorker): void {
		this.#worker.postMessage(msg);
	}

	#onMessage(msg: FromWorker): void {
		if (msg.type === "frame") {
			if (this.#disposed) {
				msg.frame.close();
				return;
			}
			// --- diagnostics ---
			if (!this.#loggedDims) {
				this.#loggedDims = true;
				const f = msg.frame;
				const vr = f.visibleRect;
				console.log(
					`[wc] geometry coded=${f.codedWidth}x${f.codedHeight} display=${f.displayWidth}x${f.displayHeight} ` +
						`visible=${vr ? `${vr.x},${vr.y} ${vr.width}x${vr.height}` : "none"} ` +
						`format=${f.format} declaredMeta=${this.width}x${this.height}`,
				);
			}
			this.#framesSeen++;
			const nowMs = performance.now();
			if (nowMs - this.#lastLogMs > 1000) {
				console.log(
					`[wc] decoded ${this.#framesSeen} frames/s · cache=${this.#cache.size} · currentSec=${(this.#currentUs / 1e6).toFixed(2)}`,
				);
				this.#framesSeen = 0;
				this.#lastLogMs = nowMs;
			}
			// --- end diagnostics ---

			const ts = msg.frame.timestamp;
			this.#cache.get(ts)?.close(); // never leak a replaced frame
			this.#cache.set(ts, msg.frame);
			this.#evict();
			this.onFrame?.();
		} else if (msg.type === "error") {
			console.error("WebCodecs worker error:", msg.message);
		}
	}

	/**
	 * The decoded frame to show at original-media time `originalSec`, or null if
	 * nothing close enough is decoded yet (caller should hold the previous
	 * frame). Nudges the worker to decode toward the requested time.
	 *
	 * The returned frame is owned by the cache — upload it, don't close it.
	 */
	frameAt(originalSec: number, floorSec = 0): VideoFrame | null {
		if (this.#disposed) return null;
		const tUs = Math.max(0, Math.round(originalSec * 1e6));
		const floorUs = Math.max(0, Math.round(floorSec * 1e6));
		this.#currentUs = tUs;
		this.#post({ type: "request", originalSec });
		return this.#bestCached(tUs, floorUs);
	}

	/**
	 * Pre-decode the GOP at `originalSec` without moving the playhead — used to
	 * warm the frames just after a cut so the jump is seamless.
	 */
	prefetch(originalSec: number): void {
		if (this.#disposed) return;
		this.#post({ type: "prefetch", originalSec });
	}

	/**
	 * Best cached frame to show at `tUs`: the greatest timestamp in
	 * [floorUs, tUs]. `floorUs` is the start of the current kept segment — frames
	 * before it belong to an earlier segment (inside a removed cut) and must NOT
	 * be shown, or the picture steps BACK into deleted content right after a cut.
	 * Within the segment we always return the closest frame at-or-before the
	 * playhead (never null just because it's a little stale), so normal playback
	 * stays smooth; null only when no in-segment frame is decoded yet, in which
	 * case the caller holds the last frame.
	 */
	#bestCached(tUs: number, floorUs: number): VideoFrame | null {
		let best: VideoFrame | null = null;
		let bestTs = -Infinity;
		for (const [ts, frame] of this.#cache) {
			if (ts >= floorUs && ts <= tUs && ts > bestTs) {
				bestTs = ts;
				best = frame;
			}
		}
		return best;
	}

	/** Drop frames outside the window around the playhead, closing each. */
	#evict(): void {
		const backUs = this.#currentUs - BACK_WINDOW_S * 1e6;
		const fwdUs = this.#currentUs + FWD_WINDOW_S * 1e6;
		for (const [ts, frame] of this.#cache) {
			if (ts < backUs || ts > fwdUs) {
				frame.close();
				this.#cache.delete(ts);
			}
		}
		if (this.#cache.size > MAX_CACHED_FRAMES) {
			const sorted = [...this.#cache.keys()].sort(
				(a, b) =>
					Math.abs(b - this.#currentUs) - Math.abs(a - this.#currentUs),
			);
			for (const ts of sorted) {
				if (this.#cache.size <= MAX_CACHED_FRAMES) break;
				this.#cache.get(ts)?.close();
				this.#cache.delete(ts);
			}
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#post({ type: "dispose" });
		for (const frame of this.#cache.values()) frame.close();
		this.#cache.clear();
		// The worker self-closes on dispose; terminate as a backstop.
		this.#worker.terminate();
	}
}
