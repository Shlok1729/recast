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

import { frameBudget } from "./frame-budget";
import { chooseIngestion } from "./mp4-sample-table";
import type { FromWorker, ToWorker } from "./webcodecs-protocol";

// The cache caps (primary `#cacheMax`, scout `#holdoutMax`) are RESOLUTION-
// ADAPTIVE — set per source from `frameBudget(width, height)`. Each held
// VideoFrame keeps one of the hardware decoder's limited output surfaces
// checked out; at 4K/5K those surfaces are 4–7× larger, so holding the 1080p
// count would starve the pool and stall the decoder. The scout holdout is kept
// SEPARATE from the main cache so the primary's eviction (which anchors on the
// pre-cut display frame and drops the farthest-ahead first) can't throw away
// the pre-warmed post-cut frames before playback reaches the cut. See
// `frame-budget.ts` for the sizing and `#evict` for the retention policy.

/** Dev-only diagnostics (throughput + first-frame geometry). Silent in
 * production; kept for debugging decode regressions. */
const DIAG = import.meta.env.DEV;

export class WebCodecsVideoSource {
	#worker: Worker;
	/** Decoded frames, keyed by ctsUs. */
	#cache = new Map<number, VideoFrame>();
	/** Protected scout-decoded frames for an upcoming post-cut GOP. Never touched
	 * by `#evict`. Bounded by `#holdoutMax`. */
	#prefetchCache = new Map<number, VideoFrame>();
	/** Resolution-adaptive caps (set in the constructor from `frameBudget`). */
	#cacheMax: number;
	#holdoutMax: number;
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

	// Dev-only diagnostics state (throughput + first-frame geometry). Gated by
	// DIAG (import.meta.env.DEV) at the log sites — silent in production builds.
	#framesSeen = 0;
	#lastLogMs = 0;
	#loggedDims = false;
	// Worst "lateness" (playhead − frame ts, ms) seen this interval. Large values
	// mean the decoder is falling behind the realtime clock for this content —
	// e.g. heavy canvas edits at high resolution — i.e. the frame the cache now
	// keeps (instead of the old window-evict) is arriving well after its time.
	#maxLateMs = 0;

	private constructor(
		worker: Worker,
		meta: { width: number; height: number; durationSec: number; fps: number },
	) {
		this.#worker = worker;
		this.width = meta.width;
		this.height = meta.height;
		this.durationSec = meta.durationSec;
		this.fps = meta.fps;
		// Size the decoded-frame caches to the resolution so 4K/5K sources don't
		// starve the decoder's output-surface pool (the keystone stall).
		const budget = frameBudget(meta.width, meta.height);
		this.#cacheMax = budget.cacheMax;
		this.#holdoutMax = budget.holdoutMax;
		if (DIAG) {
			console.log(
				`[wc] frame budget ${meta.width}x${meta.height} → cache=${budget.cacheMax} holdout=${budget.holdoutMax} decodeAhead=${budget.decodeAhead}`,
			);
		}
		// Take over message handling for the steady state (frames + late errors).
		this.#worker.onmessage = (e: MessageEvent<FromWorker>) =>
			this.#onMessage(e.data);
	}

	/**
	 * Spawn the decode worker, demux `url`, and resolve once the source can
	 * answer `frameAt`. Rejects if the file has no decodable video track or the
	 * codec/WebView isn't supported by WebCodecs — the caller should fall back
	 * to the `<video>` path.
	 *
	 * `sizeBytes` (from the backend probe) selects the ingestion strategy: small
	 * files load whole into memory (zero-network steady-state playback); large
	 * 4K/5K recordings that would blow the WebView heap switch to progressive
	 * HTTP-range ingestion (flat memory, the worker fetches the moov + GOPs on
	 * demand). See `chooseIngestion`.
	 */
	static async create(url: string, sizeBytes?: number): Promise<WebCodecsVideoSource> {
		if (typeof Worker === "undefined" || typeof VideoFrame === "undefined") {
			throw new Error("WebCodecs/Worker unavailable in this WebView");
		}
		const strategy = chooseIngestion(sizeBytes);

		// Build the init message. Whole-file fetches the bytes on the main thread
		// (the asset protocol is reliably reachable here) and transfers them in;
		// progressive hands the worker the URL so it can range-fetch lazily.
		let initMsg: ToWorker;
		let transfer: Transferable[] = [];
		if (strategy === "progressive") {
			initMsg = { type: "init-progressive", url, sizeBytes: sizeBytes as number };
		} else {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
			const buffer = await res.arrayBuffer();
			initMsg = { type: "init", buffer };
			transfer = [buffer];
		}

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
				worker.postMessage(initMsg, transfer);
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
			if (DIAG) {
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
				this.#maxLateMs = Math.max(
					this.#maxLateMs,
					(this.#currentUs - msg.frame.timestamp) / 1000,
				);
				const nowMs = performance.now();
				if (nowMs - this.#lastLogMs > 1000) {
					console.log(
						`[wc] decoded ${this.#framesSeen} frames/s · cache=${this.#cache.size} · currentSec=${(this.#currentUs / 1e6).toFixed(2)} · maxLate=${this.#maxLateMs.toFixed(0)}ms`,
					);
					this.#framesSeen = 0;
					this.#maxLateMs = 0;
					this.#lastLogMs = nowMs;
				}
			}

			const ts = msg.frame.timestamp;
			if (msg.fromScout) {
				// Scout frame for an upcoming post-cut GOP. If the primary already
				// has this timestamp, the scout copy is redundant — drop it.
				if (this.#cache.has(ts)) {
					msg.frame.close();
					return;
				}
				this.#prefetchCache.get(ts)?.close();
				this.#prefetchCache.set(ts, msg.frame);
				// Bound the holdout by count (oldest first); it's protected from #evict.
				while (this.#prefetchCache.size > this.#holdoutMax) {
					const oldest = this.#prefetchCache.keys().next().value as number;
					this.#prefetchCache.get(oldest)?.close();
					this.#prefetchCache.delete(oldest);
				}
				this.onFrame?.();
				return;
			}
			this.#cache.get(ts)?.close(); // never leak a replaced frame
			this.#cache.set(ts, msg.frame);
			// The primary now owns this timestamp for real — discard any scout copy.
			this.#prefetchCache.get(ts)?.close();
			this.#prefetchCache.delete(ts);
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
		// Also consider the scout holdout — right after a cut the only in-segment
		// frame yet decoded is the one the scout pre-warmed, which is what makes
		// the crossing seamless instead of a hold.
		for (const [ts, frame] of this.#prefetchCache) {
			if (ts >= floorUs && ts <= tUs && ts > bestTs) {
				bestTs = ts;
				best = frame;
			}
		}
		return best;
	}

	/**
	 * Evict around the frame that should currently be ON SCREEN — never by a
	 * fixed time window. The display frame is the greatest timestamp at-or-before
	 * the playhead; it is NEVER evicted, even if it arrived "late". This matters
	 * because the playback clock free-runs at realtime while decode does not: a
	 * costly frame (a Figma canvas edit, a dropdown opening — a large P-frame)
	 * decodes slower, so it lands behind the clock. The old window-based eviction
	 * dropped exactly those frames on arrival (ts < playhead − 100ms), which is
	 * why heavy on-screen changes silently vanished while static playback stayed
	 * smooth. Now a late frame is simply newer than the last displayed frame, so
	 * it becomes the display frame and is shown (a touch late) rather than lost.
	 */
	#evict(): void {
		// The frame we'd show right now.
		let displayTs = -Infinity;
		for (const ts of this.#cache.keys()) {
			if (ts <= this.#currentUs && ts > displayTs) displayTs = ts;
		}
		// Frames strictly before the display frame are spent — forward playback
		// won't revisit them, and a backward seek resets + refills the decoder.
		for (const [ts, frame] of this.#cache) {
			if (ts < displayTs) {
				frame.close();
				this.#cache.delete(ts);
			}
		}
		// Bound forward lookahead: if still over cap, drop the farthest-ahead
		// frames first so the display frame and the nearest upcoming frames stay.
		if (this.#cache.size > this.#cacheMax) {
			const ahead = [...this.#cache.keys()]
				.filter((ts) => ts > displayTs)
				.sort((a, b) => b - a); // farthest future first
			for (const ts of ahead) {
				if (this.#cache.size <= this.#cacheMax) break;
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
		for (const frame of this.#prefetchCache.values()) frame.close();
		this.#prefetchCache.clear();
		// The worker self-closes on dispose; terminate as a backstop.
		this.#worker.terminate();
	}
}
