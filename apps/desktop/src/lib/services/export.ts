/**
 * Export service — orchestration for turning an editor project into a rendered
 * file. This layer sits between the UI (the editor route) and the Rust export
 * pipeline, and is the agent-facing surface a future MCP server will call.
 *
 * It deliberately owns NO UI state (no progress rings, toasts, or dialog
 * phases). Callers feed in a project (the `EditorStore`) and receive either a
 * ready-to-render payload (`buildExportRenderState`) or the final file path
 * (`runExport`). Progress is surfaced through an optional `onState` callback so
 * the editor route can drive its own UI without this layer knowing about it.
 *
 * See ./README.md for how this fits the overall headless-core layering.
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
	/** Whether silence-cut lanes should be included. Mirrors the experimental
	 *  `silenceDetection` flag — passed in rather than imported so this service
	 *  stays decoupled from UI singletons. */
	silenceDetectionEnabled: boolean;
	hooks?: ExportPrepHooks;
}

export interface ExportRenderStatePayload {
	/** The render state to hand to {@link runExport} / `exportVideo`. */
	renderState: EditorRenderState;
	metadata: VideoMetadata | null;
}

/**
 * Build the exact render payload the Rust pipeline consumes from a project.
 *
 * This is the heart of "export" as an operation: it runs the two hybrid-raster
 * passes (text annotations → PNG, cursor → sprite sheet) and honors the
 * per-lane enable toggles (focus / annotations / cuts) without mutating the
 * store. The result is fully serializable, so an agent can build it, inspect
 * it, and pass it straight to {@link runExport}.
 */
export async function buildExportRenderState(
	store: EditorStore,
	opts: BuildExportRenderStateOptions,
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

	// Run the two hybrid-raster passes in parallel — they don't depend on each
	// other and the cursor SVG decode is non-trivial on cold boot (Image()
	// onload is async even for inline blobs). This trims perceived "Preparing…"
	// time roughly in half on projects with text.
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
	// Honor the per-lane "enable" toggles. The underlying data is preserved on
	// the store; here we just hand the export pipeline the active set, so
	// toggling a lane off bypasses its effect in the rendered file.
	const finalRenderState: EditorRenderState = {
		...renderState,
		annotations: store.annotationsGloballyHidden ? [] : expandedAnnotations,
		zoomRegions: store.focusEnabled ? renderState.zoomRegions : [],
		cuts:
			opts.silenceDetectionEnabled && store.cutsEnabled
				? renderState.cuts
				: [],
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
 * pipeline, and tear the listener down when finished. Resolves to the output
 * file path; rejects (or emits an `error`/`cancelled` state event) on failure.
 *
 * UI lifecycle (isExporting flags, result overlays, ETA) stays with the caller
 * — this only owns the IPC round-trip and listener lifetime.
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
