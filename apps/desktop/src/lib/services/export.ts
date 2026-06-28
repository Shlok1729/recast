/**
 * Export service — turns an editor project into a rendered file. Sits between
 * the UI and the Rust pipeline; the agent-facing surface a future MCP server
 * calls. Owns NO UI state — progress is surfaced via an optional `onState`
 * callback. See ./README.md for the headless-core layering.
 */

import { rasterizeCursorSprites } from "$lib/export/rasterize-cursor";
import { expandTextAnnotations } from "$lib/export/rasterize-text";
import {
	type ExportGifSettings,
	type ExportSpeed,
	type ExportStateEvent,
	exportVideo,
	listenToExportState,
} from "$lib/ipc";
import {
	type EditorRenderState,
	type EditorStore,
	type VideoMetadata,
	framePaddingPixels,
} from "$lib/stores/editor-store.svelte";

/** Optional progress hooks for the hybrid-raster "Preparing…" phase. Each fires
 *  as its lane starts/finishes so the UI can show sub-stage progress. Omit for
 *  headless callers that don't need staging feedback. */
export interface ExportPrepHooks {
	onText?(status: "running" | "done"): void;
	onCursor?(status: "running" | "done"): void;
	onSending?(status: "running" | "done"): void;
}

export interface BuildExportRenderStateOptions {
	hooks?: ExportPrepHooks;
}

export interface ExportRenderStatePayload {
	/** The render state to hand to {@link runExport} / `exportVideo`. */
	renderState: EditorRenderState;
	metadata: VideoMetadata | null;
}

/**
 * Build the render payload the Rust pipeline consumes from a project: runs the
 * two hybrid-raster passes (text → PNG, cursor → sprite sheet) and honors the
 * per-lane enable toggles (focus/annotations/cuts) without mutating the store.
 * Fully serializable, so an agent can build, inspect, and pass it to {@link runExport}.
 */
export async function buildExportRenderState(
	store: EditorStore,
	opts: BuildExportRenderStateOptions = {},
): Promise<ExportRenderStatePayload> {
	const { hooks } = opts;
	const renderState = store.toRenderState();
	const meta = store.metadata;
	const paddingPx = framePaddingPixels(renderState.padding ?? 0, meta);
	const canvasW = meta ? meta.width + paddingPx * 2 : 0;
	const canvasH = meta ? meta.height + paddingPx * 2 : 0;

	const hasText = renderState.annotations.some((a) => a.kind.kind === "text");
	const hasStyledCursor = store.cursorSettings.style !== "dot";
	hooks?.onText?.(hasText ? "running" : "done");
	hooks?.onCursor?.(hasStyledCursor ? "running" : "done");

	// Run both hybrid-raster passes in parallel — independent, and the cursor SVG
	// decode is non-trivial on cold boot (Image() onload is async even for blobs).
	const [expandedAnnotations, cursorSprites] = await Promise.all([
		expandTextAnnotations(renderState.annotations, canvasW, canvasH).then(
			(r) => {
				hooks?.onText?.("done");
				return r;
			},
		),
		rasterizeCursorSprites(
			store.cursorSettings.style,
			store.cursorSettings.size * 16,
		).then((r) => {
			hooks?.onCursor?.("done");
			return r;
		}),
	]);

	hooks?.onSending?.("running");
	// Hand the pipeline only the active set per lane toggle; store data is preserved.
	const finalRenderState: EditorRenderState = {
		...renderState,
		annotations: store.annotationsGloballyHidden ? [] : expandedAnnotations,
		zoomRegions: store.focusEnabled ? renderState.zoomRegions : [],
		// `effectiveCuts` = the flag-gated, lane-enabled subset, so the export
		// matches the previewed edit. Inactive cuts stay on the store, not here.
		cuts: store.effectiveCuts,
		cursorSpriteRest: cursorSprites?.rest,
		cursorSpritePress: cursorSprites?.press,
		cursorSpriteRightPress: cursorSprites?.rightPress,
		cursorSpriteDrag: cursorSprites?.drag,
		cursorSpriteHotspotRest: cursorSprites?.restHotspot,
		cursorSpriteHotspotPress: cursorSprites?.pressHotspot,
		cursorSpriteHotspotRightPress: cursorSprites?.rightPressHotspot,
		cursorSpriteHotspotDrag: cursorSprites?.dragHotspot,
		cursorSpriteSizePx: cursorSprites?.pixelSize,
	};
	hooks?.onSending?.("done");

	return { renderState: finalRenderState, metadata: meta };
}

export interface RunExportOptions {
	/** Source media path (the recording file or project path). */
	inputPath: string;
	format: string;
	quality: string;
	/** Built via {@link buildExportRenderState}. */
	renderState: EditorRenderState;
	exportId: string;
	gifSettings?: ExportGifSettings;
	speed?: ExportSpeed;
	/** Output frame rate for MP4/WebM; `null`/omitted keeps source rate. */
	fps?: number | null;
	/** Progress/lifecycle events from the Rust pipeline. The service manages
	 *  listener registration and teardown around the export call. */
	onState?(event: ExportStateEvent): void;
}

/**
 * Run an export end to end: register the progress listener, invoke the Rust
 * pipeline, tear the listener down when finished. Resolves to the output path;
 * rejects (or emits an `error`/`cancelled` event) on failure. UI lifecycle
 * stays with the caller — this owns only the IPC round-trip and listener.
 */
export async function runExport(opts: RunExportOptions): Promise<string> {
	const unlisten = opts.onState
		? await listenToExportState(opts.exportId, opts.onState)
		: null;
	try {
		return await exportVideo(
			opts.inputPath,
			opts.format,
			opts.quality,
			opts.renderState,
			opts.exportId,
			opts.gifSettings,
			opts.speed ?? "balanced",
			opts.fps,
		);
	} finally {
		unlisten?.();
	}
}
