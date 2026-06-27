/**
 * Message protocol between the main thread (`client.ts`) and the conversion
 * worker (`convert-worker.ts`). Kept in its own module so both sides share one
 * definition and neither imports the other's runtime code.
 *
 * Every tool is one `op`. The worker runs the job off the main thread, streams
 * progress back, and returns a single output Blob. All conversion happens in the
 * browser — nothing is uploaded.
 */

/** The conversion operations the worker can run. Grouped by capability tier
 * (see `capabilities.ts`): container ops need no codec, decode ops need a
 * decoder, encode ops need a `VideoEncoder` (Chromium-first). */
export type ToolOp =
	// Tier A — container only (no WebCodecs): rewrap/copy streams.
	| "trim" // cut [start, end], keyframe-aligned stream copy
	| "mute" // drop the audio track
	| "extract-audio" // pull the audio track out as-is (no re-encode)
	// Tier B — decode only: read frames/samples, encode with a small JS/WASM codec.
	| "video-to-gif"
	| "audio-to-mp3"
	| "extract-frames" // frames → PNG/JPG (zip or single)
	// Tier C — encode (VideoEncoder): touch pixels and re-encode.
	| "transcode" // change codec/container (mp4 <-> webm, mov -> mp4)
	| "compress" // re-encode at a lower bitrate
	| "resize"; // scale dimensions

/** Per-op options. Loosely typed for now; each handler narrows what it needs. */
export interface ToolOptions {
	/** trim: seconds. */
	startSec?: number;
	endSec?: number;
	/** video-to-gif / resize: target dimensions (height auto if omitted). */
	width?: number;
	height?: number;
	/** video-to-gif: output frame rate, e.g. 10–15. */
	fps?: number;
	/** transcode/compress: target container + codecs. */
	container?: "mp4" | "webm";
	videoCodec?: string;
	audioCodec?: string;
	/** compress: target average bitrate (bits/sec). */
	videoBitrate?: number;
	/** extract-audio / audio-to-mp3: output format. */
	audioFormat?: "mp3" | "wav" | "m4a";
	/** extract-frames: still format + how many evenly-spaced frames. */
	imageFormat?: "png" | "jpeg";
	frameCount?: number;
}

/** A single conversion request. */
export interface ConvertJob {
	/** Caller-assigned id, echoed on every message for this job. */
	id: string;
	op: ToolOp;
	/** The user's file. Structured-cloned to the worker (no full copy). */
	file: File;
	options: ToolOptions;
}

/** Main thread -> worker. */
export type ToConvertWorker =
	| { type: "run"; job: ConvertJob }
	| { type: "cancel"; id: string };

/** Why a job failed — drives the message we show, and whether to funnel to the
 * desktop app (`too-large`) or suggest another browser (`unsupported`). */
export type ConvertErrorCode =
	| "unsupported" // a required WebCodecs capability isn't available here
	| "too-large" // input exceeds this device's in-browser budget
	| "bad-input" // couldn't demux/decode the file (unsupported container/codec)
	| "cancelled"
	| "internal";

/** Worker -> main thread. */
export type FromConvertWorker =
	| { type: "progress"; id: string; ratio: number; stage?: string }
	| {
			type: "result";
			id: string;
			blob: Blob;
			filename: string;
			mime: string;
	  }
	| { type: "error"; id: string; code: ConvertErrorCode; message: string };

/** Thrown inside a handler to fail a job with a specific, user-facing code. */
export class ConvertError extends Error {
	constructor(
		readonly code: ConvertErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ConvertError";
	}
}

/** Context handed to each handler: report progress (0..1) and observe cancel. */
export interface JobContext {
	signal: AbortSignal;
	onProgress: (ratio: number, stage?: string) => void;
}

/** What a handler returns: the finished file. */
export interface HandlerResult {
	blob: Blob;
	filename: string;
	mime: string;
}

/** A conversion implementation for one op. */
export type ConvertHandler = (
	job: ConvertJob,
	ctx: JobContext,
) => Promise<HandlerResult>;
