/**
 * Analysis service — orchestration for the "understand this recording and
 * suggest edits" operations. Today that's smart auto-zoom (detect clicks +
 * motion settle → place focus regions); silence detection lives alongside it.
 *
 * Like the export service, this owns NO UI state (no toasts, no run-guards).
 * It performs the IPC + computation + persistence and returns a structured
 * outcome; the caller decides how to surface it. This is the surface a future
 * MCP "auto-edit" tool will call.
 *
 * See ./README.md for how this fits the overall headless-core layering.
 */

import { autosaveProject, suggestZoomRegions } from "$lib/ipc";
import type { EditorStore } from "$lib/stores/editor-store.svelte";
import { applyAutoZooms } from "$lib/zoom/auto-apply";

export interface AutoZoomOutcome {
	/** Number of focus regions actually placed. */
	applied: number;
	reason: "applied" | "empty" | "bad-bounds";
}

export interface GenerateAutoZoomOptions {
	/** Persist the result immediately so a crash before the next autosave tick
	 *  doesn't re-run auto-zoom and double up regions. Omit to skip persistence
	 *  (e.g. a headless caller managing its own save). */
	documentPath?: string;
}

/**
 * Detect focus candidates from a cursor track and place focus regions on the
 * project. Pushes a single coalesced undo entry covering all placed regions.
 *
 * Returns an outcome describing what happened; it does NOT toast, latch
 * `autoZoomApplied`, or guard against concurrent runs — those are UI concerns
 * the caller owns.
 */
export async function generateAutoZoom(
	store: EditorStore,
	cursorPath: string,
	opts: GenerateAutoZoomOptions = {},
): Promise<AutoZoomOutcome> {
	const suggestions = await suggestZoomRegions(cursorPath);
	const dur = store.metadata?.duration ?? 0;
	const w = store.metadata?.width ?? 0;
	const h = store.metadata?.height ?? 0;
	const bounds = {
		start: store.inPoint,
		end: store.outPoint > 0 ? store.outPoint : dur,
	};
	if (bounds.end <= bounds.start) {
		return { applied: 0, reason: "bad-bounds" };
	}

	// Single coalesced undo entry covering all auto-applied regions.
	store.pushUndoState();
	const result = applyAutoZooms(store, suggestions, bounds, w, h);

	if (opts.documentPath) {
		try {
			await autosaveProject(
				opts.documentPath,
				JSON.stringify(store.toRenderState()),
			);
		} catch (err) {
			console.warn("Auto-zoom autosave failed:", err);
		}
	}

	return {
		applied: result.applied,
		reason: result.applied > 0 ? "applied" : "empty",
	};
}
