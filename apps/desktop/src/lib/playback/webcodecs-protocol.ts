/**
 * Message protocol between the main thread (`webcodecs-source.ts`) and the
 * decode worker (`webcodecs-worker.ts`). Kept in its own module so both sides
 * share one definition and neither has to import the other's runtime code.
 */

/** Main → worker. */
export type ToWorker =
	/** The whole MP4 file, fetched on the main thread and transferred in. */
	| { type: "init"; buffer: ArrayBuffer }
	/**
	 * Progressive ingestion: the worker fetches the `moov` index and then each
	 * GOP's media bytes on demand via HTTP Range requests against `url` (the
	 * Tauri asset URL), keeping memory flat for multi-GB recordings. `sizeBytes`
	 * (from the backend probe) lets it locate a tail `moov` without a HEAD.
	 */
	| { type: "init-progressive"; url: string; sizeBytes: number }
	/** Tell the worker the current playhead so it can decode-ahead. */
	| { type: "request"; originalSec: number }
	/** Warm a different GOP (e.g. just after a cut) without moving the playhead. */
	| { type: "prefetch"; originalSec: number }
	| { type: "dispose" };

/** Worker → main. */
export type FromWorker =
	| {
			type: "ready";
			width: number;
			height: number;
			durationSec: number;
			fps: number;
	  }
	/**
	 * A decoded frame, transferred (listed in the postMessage transfer list).
	 * `fromScout` marks frames produced by the prefetch (scout) decoder for an
	 * upcoming post-cut GOP — the main side parks those in a small protected
	 * holdout so the primary's eviction can't drop them before the cut is reached.
	 */
	| { type: "frame"; frame: VideoFrame; fromScout?: boolean }
	| { type: "error"; message: string };
