/**
 * Message protocol between the filmstrip provider (filmstrip-source.ts) and its
 * decode worker (filmstrip-worker.ts). Separate module so both sides share one
 * definition without importing the other's runtime code.
 */

/** Provider → worker. */
export type ToFilmstripWorker =
	/** The whole MP4, fetched on the main thread and transferred in, plus the
	 *  device-pixel tile height to downscale each thumbnail to. */
	| { type: "init"; buffer: ArrayBuffer; tileHeightPx: number }
	/** A batch of thumbnails to decode. Each `id` correlates the reply. The worker
	 *  groups them by GOP so one keyframe decode serves every tile in it. */
	| { type: "decode"; requests: Array<{ id: number; originalSec: number }> }
	| { type: "dispose" };

/** Worker → provider. */
export type FromFilmstripWorker =
	| {
			type: "ready";
			width: number;
			height: number;
			durationSec: number;
			fps: number;
	  }
	/** A decoded, downscaled thumbnail as a compressed blob (cheap to clone; the
	 *  provider turns it into an object URL for an `<img>`). */
	| { type: "tile"; id: number; blob: Blob }
	| { type: "error"; message: string };
