/**
 * External-open pipeline for `.recast` files.
 *
 * Used whenever a project file arrives from outside the in-app recordings
 * list — today that's only the OS file association (double-click in
 * Explorer/Finder/Files), but the same helper is reusable for future
 * "File → Open…" menu items and drag-onto-app-icon flows.
 *
 * External opens always land in a fresh editor window — they never
 * navigate the main window. That's a deliberate UX contract: the user's
 * library view stays put, and a new project never disturbs unsaved edits
 * in another editor window. Same path opened twice → focus the existing
 * window (label-based dedupe).
 */
import { analytics } from "$lib/analytics/client";
import { isRecordingActive, peekRecastProject } from "$lib/ipc";
import { toast } from "@recast/ui/sonner";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

/**
 * Match the encoding used by the recasts list so a path that resolves to
 * the same on-disk file produces the same editor route and window label
 * (label-based dedupe in `openProjectInNewWindow` relies on this).
 */
export function encodeEditorPath(path: string): string {
  return encodeURIComponent(btoa(encodeURIComponent(path)));
}

/**
 * Open a path in a new editor webview, or focus the existing one if a
 * window for this path is already up. The label is derived from the
 * encoded path, so re-opening the same file is idempotent.
 */
export async function openProjectInNewWindow(path: string): Promise<void> {
  const encoded = encodeEditorPath(path);
  const route = `/editor/${encoded}`;
  const label = `editor-${encoded.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48)}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: route,
    title: `Editor - ${basename(path)}`,
    width: 1440,
    height: 960,
    center: true,
    decorations: false,
  });
  // No-op unless product analytics are on. No PII — the path never leaves.
  analytics.capture("editor_opened");
}

/**
 * Validate, then open. Surfaces a toast and bails on each failure mode
 * the editor route can't recover from:
 *
 *   - Active recording → editor windows kick off FFmpeg thumbnail probes
 *     that compete with the capture pipeline for CPU. Refuse instead of
 *     degrading the recording.
 *   - File missing / unreadable → toast the OS error verbatim.
 *   - Not a valid zip / no metadata.json → "Not a valid Recast project".
 *
 * Always lands in a new editor window (never navigates main).
 */
export async function openProjectFromExternalPath(
  path: string,
): Promise<void> {
  // Best-effort guard. If the IPC fails for any reason, treat it as
  // "not recording" rather than blocking the open — the user can always
  // start the editor anyway from the recasts list if something's wedged.
  let recording = false;
  try {
    recording = await isRecordingActive();
  } catch (e) {
    console.warn("[open-recast] is_recording_active probe failed", e);
  }
  if (recording) {
    toast.warning("Finish recording before opening another project");
    return;
  }

  try {
    await peekRecastProject(path);
  } catch (e) {
    toast.error(
      `Couldn't open "${basename(path)}" — ${describeError(e)}`,
    );
    return;
  }

  await openProjectInNewWindow(path);
}
