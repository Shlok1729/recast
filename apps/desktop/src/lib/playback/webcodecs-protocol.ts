/**
 * Message protocol between the main thread (`webcodecs-source.ts`) and the
 * decode worker (`webcodecs-worker.ts`). Kept in its own module so both sides
 * share one definition and neither has to import the other's runtime code.
 */

/** Main → worker. */
export type ToWorker =
	| { type: "init"; url: string }
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
	/** A decoded frame, transferred (listed in the postMessage transfer list). */
	| { type: "frame"; frame: VideoFrame }
	| { type: "error"; message: string };
