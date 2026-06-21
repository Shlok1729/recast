/// <reference lib="webworker" />
/**
 * WebCodecs decode worker — the off-main-thread half of the preview engine.
 *
 * Per the WebCodecs best-practices guide, the actual decode already runs on the
 * browser's internal threads; what we move here is everything *around* it that
 * would otherwise run on the WebView's main thread: the mp4box demux, the
 * sample-index build, the per-frame decoder `output()` callback, and the
 * decode-ahead scheduling. The main thread is left with just the WebGL upload
 * and the existing compositor.
 *
 * The worker owns no decoded frames: each frame is transferred to the main
 * thread the instant it's decoded (transfer neuters the worker's handle, so we
 * never double-own or leak). The main side keeps the bounded cache and answers
 * the render loop synchronously. The worker only owns the encoded samples + the
 * decoder, and schedules feeding based on the playhead time the main thread
 * sends it.
 */

import {
	createFile,
	DataStream,
	type ISOFile,
	MP4BoxBuffer,
	type Movie,
	type Sample,
	type Track,
} from "mp4box";
import {
	buildKeyframes,
	buildPresOrder,
	type ChunkMeta,
	keyframeAtOrBefore,
	needsReset,
	sampleAtOrBefore,
} from "./frame-index";
import type { FromWorker, ToWorker } from "./webcodecs-protocol";

/** Samples (decode order) to keep decoded ahead of the playhead. */
const DECODE_AHEAD = 24;
/** Cap on the decoder's in-flight queue so we don't overfeed during a burst. */
const QUEUE_MAX = 12;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let chunks: ChunkMeta[] = [];
let keyframes: number[] = [];
let presOrder: number[] = [];
let decoder: VideoDecoder | null = null;
let config: VideoDecoderConfig | null = null;
let anchorKey = -1;
let feedCursor = 0;
let currentUs = 0;
let disposed = false;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
	ctx.postMessage(msg, transfer);
}

async function init(url: string): Promise<void> {
	if (typeof VideoDecoder === "undefined") {
		post({ type: "error", message: "WebCodecs VideoDecoder unavailable" });
		return;
	}
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
		const ab = await res.arrayBuffer();

		const file = createFile();
		const collected: ChunkMeta[] = [];

		// Resolve with track + config so they reach the linear flow as properly
		// typed non-null locals — TS can't see assignments made inside these
		// mp4box callbacks, and would otherwise narrow them to `never`.
		const ready = new Promise<{ track: Track; cfg: VideoDecoderConfig }>((resolve, reject) => {
			let track: Track | null = null;
			let cfg: VideoDecoderConfig | null = null;
			file.onError = (e: string) => reject(new Error(`mp4box: ${e}`));
			file.onReady = (info: Movie) => {
				const vtrack =
					info.videoTracks?.[0] ??
					info.tracks.find((t) => t.type === "video") ??
					null;
				if (!vtrack) {
					reject(new Error("no video track in source"));
					return;
				}
				track = vtrack;
				cfg = {
					codec: vtrack.codec,
					codedWidth: vtrack.video?.width ?? vtrack.track_width,
					codedHeight: vtrack.video?.height ?? vtrack.track_height,
					description: extractDescription(file, vtrack.id),
					optimizeForLatency: true,
				};
				file.setExtractionOptions(vtrack.id, null, { nbSamples: Infinity });
				file.start();
			};
			file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
				for (const s of samples) {
					const ts = s.timescale || 1;
					collected.push({
						ctsUs: Math.round((s.cts / ts) * 1e6),
						durUs: Math.round((s.duration / ts) * 1e6),
						key: s.is_sync,
						data: s.data ? s.data.slice() : new Uint8Array(0),
					});
				}
				if (track && cfg && collected.length >= track.nb_samples)
					resolve({ track, cfg });
			};
		});

		file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0), true);
		file.flush();
		const { track, cfg } = await ready;

		if (collected.length === 0) throw new Error("demux produced no samples");

		const support = await VideoDecoder.isConfigSupported(cfg);
		if (!support.supported) {
			throw new Error(`codec not supported: ${cfg.codec}`);
		}

		chunks = collected;
		keyframes = buildKeyframes(chunks);
		presOrder = buildPresOrder(chunks);
		config = cfg;
		decoder = new VideoDecoder({
			output: (frame) => {
				if (disposed) {
					frame.close();
					return;
				}
				// Transfer ownership to the main thread; do NOT close after — the
				// transfer detaches our handle.
				post({ type: "frame", frame }, [frame]);
			},
			error: (e) => post({ type: "error", message: String(e) }),
		});
		decoder.configure(config);

		const durationSec =
			track.movie_timescale > 0
				? track.movie_duration / track.movie_timescale
				: 0;
		post({
			type: "ready",
			width: track.video?.width ?? track.track_width,
			height: track.video?.height ?? track.track_height,
			durationSec,
			fps: durationSec > 0 ? track.nb_samples / durationSec : 30,
		});
	} catch (err) {
		post({ type: "error", message: err instanceof Error ? err.message : String(err) });
	}
}

/** Ensure the decoder is feeding the GOP that covers decode-index `target`. */
function schedule(target: number): void {
	if (!decoder || !config) return;
	const kf = keyframeAtOrBefore(keyframes, target);
	if (needsReset(anchorKey, feedCursor, kf)) {
		decoder.reset();
		decoder.configure(config); // reset() drops the config
		anchorKey = kf;
		feedCursor = kf;
	}
	const end = Math.min(target + DECODE_AHEAD, chunks.length - 1);
	while (feedCursor <= end && decoder.decodeQueueSize < QUEUE_MAX) {
		const c = chunks[feedCursor];
		decoder.decode(
			new EncodedVideoChunk({
				type: c.key ? "key" : "delta",
				timestamp: c.ctsUs,
				duration: c.durUs,
				data: c.data,
			}),
		);
		feedCursor++;
	}
}

function request(originalSec: number): void {
	if (disposed || chunks.length === 0) return;
	currentUs = Math.max(0, Math.round(originalSec * 1e6));
	schedule(sampleAtOrBefore(chunks, presOrder, currentUs));
}

function prefetch(originalSec: number): void {
	if (disposed || chunks.length === 0 || !decoder) return;
	const tUs = Math.max(0, Math.round(originalSec * 1e6));
	const target = sampleAtOrBefore(chunks, presOrder, tUs);
	const kf = keyframeAtOrBefore(keyframes, target);
	// Only warm a DIFFERENT GOP, and only while the decoder is idle enough not
	// to starve the current playhead.
	if (kf === anchorKey) return;
	if (decoder.decodeQueueSize > 0) return;
	schedule(target);
}

function dispose(): void {
	if (disposed) return;
	disposed = true;
	try {
		if (decoder && decoder.state !== "closed") decoder.close();
	} catch {
		/* already closing */
	}
	decoder = null;
	chunks = [];
	ctx.close();
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
	const msg = e.data;
	switch (msg.type) {
		case "init":
			void init(msg.url);
			break;
		case "request":
			request(msg.originalSec);
			break;
		case "prefetch":
			prefetch(msg.originalSec);
			break;
		case "dispose":
			dispose();
			break;
	}
};

/**
 * Pull the codec config (avcC / hvcC / av1C / vpcC) out of the sample
 * description as the raw box payload WebCodecs expects (box contents minus the
 * 8-byte size+type header).
 */
function extractDescription(file: ISOFile, trackId: number): Uint8Array {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const trak = file.getTrackById(trackId) as any;
	const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
	for (const entry of entries) {
		const box = entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC;
		if (box) {
			// Default endianness is BIG_ENDIAN (network order), as avcC requires.
			const stream = new DataStream(undefined, 0);
			box.write(stream);
			return new Uint8Array(stream.buffer, 8);
		}
	}
	throw new Error("no codec description (avcC/hvcC/...) in sample table");
}
