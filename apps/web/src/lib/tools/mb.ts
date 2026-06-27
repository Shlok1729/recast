/**
 * MediaBunny helpers shared by the conversion handlers. MediaBunny does the
 * demux/mux and, through its `Conversion` API, most of the codec work
 * (trim, mute, resize, compress, transcode, extract-audio). These wrappers add
 * our progress + cancellation plumbing and consistent error mapping on top.
 */

import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	type ConversionAudioOptions,
	type ConversionVideoOptions,
	Input,
	Mp4OutputFormat,
	type OutputFormat,
	Output,
	WavOutputFormat,
	WebMOutputFormat,
} from "mediabunny";
import { ConvertError, type JobContext } from "./worker-protocol";

/** Open a user file as a MediaBunny input, erroring clearly if unreadable. */
export async function openInput(file: File): Promise<Input> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		if (!(await input.canRead())) {
			throw new ConvertError("bad-input", "Couldn't read this file. Try MP4, MOV, or WebM.");
		}
	} catch (err) {
		input.dispose();
		if (err instanceof ConvertError) throw err;
		throw new ConvertError("bad-input", "This file isn't a supported video. Try MP4, MOV, or WebM.");
	}
	return input;
}

export type ContainerKind = "mp4" | "webm";

export function outputFormatFor(kind: ContainerKind): OutputFormat {
	return kind === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
}

/** Family of the input container, so "keep the same format" ops don't force a
 * needless transcode. */
export async function inputContainerKind(input: Input): Promise<ContainerKind> {
	try {
		const mime = await input.getMimeType();
		return /webm|matroska|x-matroska/i.test(mime) ? "webm" : "mp4";
	} catch {
		return "mp4";
	}
}

export interface ConversionParams {
	outputFormat: OutputFormat;
	video?: ConversionVideoOptions;
	audio?: ConversionAudioOptions;
	trim?: { start?: number; end?: number };
}

/**
 * Run a MediaBunny `Conversion` end to end and return the output bytes, wiring
 * progress to the job and cancellation to the abort signal. The caller owns the
 * `Input` (so it can read tracks first); we dispose nothing it passed in.
 */
export async function runConversion(
	input: Input,
	params: ConversionParams,
	ctx: JobContext,
): Promise<ArrayBuffer> {
	const target = new BufferTarget();
	const output = new Output({ format: params.outputFormat, target });

	const conversion = await Conversion.init({
		input,
		output,
		video: params.video,
		audio: params.audio,
		trim: params.trim,
		showWarnings: false,
	});
	if (!conversion.isValid) {
		throw new ConvertError(
			"bad-input",
			"This file can't be converted with these settings (no usable track).",
		);
	}
	conversion.onProgress = (p) => ctx.onProgress(p);

	const onAbort = () => void conversion.cancel();
	ctx.signal.addEventListener("abort", onAbort, { once: true });
	try {
		await conversion.execute();
	} catch (err) {
		if (ctx.signal.aborted) throw new ConvertError("cancelled", "Cancelled.");
		throw new ConvertError(
			"bad-input",
			err instanceof Error ? err.message : "Conversion failed.",
		);
	} finally {
		ctx.signal.removeEventListener("abort", onAbort);
	}

	if (!target.buffer) throw new ConvertError("internal", "No output was produced.");
	return target.buffer;
}

/** Replace a file's extension. */
export function withExtension(name: string, ext: string): string {
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name;
	return `${base}.${ext}`;
}
