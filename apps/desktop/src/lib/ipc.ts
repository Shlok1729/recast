/**
 * Typed IPC wrappers for Tauri backend commands.
 *
 * All invoke() calls should go through these functions instead of using
 * raw invoke() strings. This gives us:
 * - Type safety for arguments and return values
 * - Single place to update if command signatures change
 * - Better IDE autocomplete
 */

import type { EditorRenderState, VideoMetadata } from "$lib/stores/editor-store.svelte";
import { analytics } from "$lib/analytics/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { platform } from "@tauri-apps/plugin-os";

// `alwaysOnTop` works fine on Windows (DWM handles z-order cleanly) but on
// some Linux compositors (notably KWin under Wayland) an undecorated,
// transparent, always-on-top window can hold input focus in a way the user
// can't break out of — clicks pass through to it instead of the main window
// behind, so close/minimize/maximize on the main window stop working. Drop
// the flag on Linux until we have a proper compositor-side fix.
const IS_LINUX = platform() === "linux";

//  Types matching Rust structs 

export interface DisplayInfo {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	isPrimary: boolean;
	thumbnail: string | null;
}

export interface WindowInfo {
	id: number;
	pid: number;
	appName: string;
	title: string;
	x: number;
	y: number;
	width: number;
	height: number;
	isMinimized: boolean;
	thumbnail: string | null;
}

export interface RecordingEntry {
	filename: string;
	path: string;
	sizeBytes: number;
	created: number;
}

export interface EditorDocument {
	projectPath: string;
	mediaPath: string;
	cursorPath?: string | null;
	editsPath?: string | null;
	audioPath?: string | null;
	microphonePath?: string | null;
	cameraPath?: string | null;
	metadata: VideoMetadata;
	renderState: EditorRenderState;
}

export interface AutosaveState {
	projectPath: string;
	savedAtUnixMs: number;
	editsJson: string;
}

//  System commands

/** One encoder candidate (H.264 or HEVC) and whether it really initializes
 *  here. Mirrors the Rust `EncoderAvailability` struct (`probe_video_encoders`). */
export interface EncoderAvailability {
	name: string;
	label: string;
	vendor: string;
	/** Codec family — "H.264" or "HEVC" — used to group the matrix. */
	family: string;
	hardware: boolean;
	available: boolean;
	active: boolean;
}

/** ffmpeg/ffprobe resolution + codec diagnostics. Mirrors the Rust
 *  `FfmpegDiagnostics` struct (`diagnose_ffmpeg`). */
export interface FfmpegDiagnostics {
	ffmpeg_path: string;
	ffprobe_path: string;
	version: string | null;
	h264_encoder: string;
	encoders_present: string[];
	encoders_missing: string[];
}

/** Probe which video encoders actually work on this device (real init
 *  probe, not just "compiled in"). Each hardware probe spawns ffmpeg, so
 *  this can take up to ~2s cold — call it off the render path. */
export function probeVideoEncoders(): Promise<EncoderAvailability[]> {
	return invoke<EncoderAvailability[]>("probe_video_encoders");
}

/** Resolved ffmpeg paths, version, and which export codecs are present. */
export function diagnoseFfmpeg(): Promise<FfmpegDiagnostics> {
	return invoke<FfmpegDiagnostics>("diagnose_ffmpeg");
}

/**
 * Lock a window's resize to a fixed aspect ratio and cap its width at a
 * fraction of its monitor. On Windows this is a real-time WM_SIZING constraint
 * (proportional while dragging); other platforms no-op and rely on the JS
 * snap-to-aspect fallback. Re-call when the ratio changes.
 *
 * @param minWidthPx minimum width in *physical* pixels (the OS drag rect is
 *   physical too) — pass `logicalMin * devicePixelRatio`.
 */
export function setWindowAspectRatio(
	label: string,
	aspectWidth: number,
	aspectHeight: number,
	maxScreenFraction: number,
	minWidthPx: number,
): Promise<void> {
	return invoke("set_window_aspect_ratio", {
		label,
		aspectWidth,
		aspectHeight,
		maxScreenFraction,
		minWidthPx,
	});
}

export function getOutputDir(): Promise<string> {
	return invoke<string>("get_output_dir");
}

export function setOutputDir(path: string): Promise<void> {
	return invoke("set_output_dir", { path });
}

export function getDisplays(): Promise<DisplayInfo[]> {
	return invoke<DisplayInfo[]>("get_displays");
}

export function getWindows(): Promise<WindowInfo[]> {
	return invoke<WindowInfo[]>("get_windows");
}

export function openFileLocation(path: string): Promise<void> {
	return invoke("open_file_location", { path });
}

/** Move a file to the OS recycle bin / trash. Recoverable via the OS. */
export function deleteFile(path: string): Promise<void> {
	return invoke("delete_file", { path });
}

/**
 * Rename a file in place. If `newName` has no extension, the original extension
 * is preserved. Returns the new absolute path.
 */
export function renameFile(path: string, newName: string): Promise<string> {
	return invoke<string>("rename_file", { path, newName });
}

//  Recording commands

export interface RecordingOptions {
	systemAudio?: boolean;
	microphone?: boolean;
	microphoneDeviceId?: string | null;
	camera?: boolean;
	cameraDeviceId?: string | null;
}

export interface AudioDeviceInfo {
	id: string;
	name: string;
	isDefault: boolean;
}

export interface CameraDeviceInfo {
	id: string;
	name: string;
	status?: "ready" | "warning" | "error" | "unknown";
	statusMessage?: string | null;
}

export interface CameraValidationResult {
	id: string;
	name: string;
	status: "ready" | "warning" | "error" | "unknown";
	statusMessage?: string | null;
	probedAtUnixMs: number;
}

export interface CameraPreviewState {
	mirror: boolean;
	shape: "square" | "rectangle" | "rounded" | "circle";
	cornerRadius: number;
	animationPreset: "none" | "soft" | "lively";
	windowX: number;
	windowY: number;
	windowWidth: number;
	windowHeight: number;
}

export interface RecordingStartResult {
	warnings: string[];
}

export interface RegionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function startRecording(
	targetType: string,
	targetId: number,
	options?: RecordingOptions,
	region?: RegionRect | null,
): Promise<RecordingStartResult> {
	// No-op unless the user opted into product analytics. No PII — source kind only.
	analytics.capture("recording_started", { source_kind: targetType });
	return invoke<RecordingStartResult>("start_recording", {
		targetType,
		targetId,
		region: region ?? null,
		options: options ?? null,
	});
}

export interface LastSource {
	kind: "monitor" | "window" | "region";
	id: number;
	label: string;
	regionX?: number | null;
	regionY?: number | null;
	regionWidth?: number | null;
	regionHeight?: number | null;
}

export function getLastSource(): Promise<LastSource | null> {
	return invoke<LastSource | null>("get_last_source");
}

export function setLastSource(source: LastSource): Promise<void> {
	return invoke("set_last_source", { source });
}

export function getAudioDevices(): Promise<AudioDeviceInfo[]> {
	return invoke<AudioDeviceInfo[]>("get_audio_devices");
}

export function getCameraDevices(): Promise<CameraDeviceInfo[]> {
	return invoke<CameraDeviceInfo[]>("get_camera_devices");
}

export function validateCameraSource(deviceId: string): Promise<CameraValidationResult> {
	return invoke<CameraValidationResult>("validate_camera_source", { deviceId });
}

export function updateCameraPreviewState(state: CameraPreviewState): Promise<void> {
	return invoke("update_camera_preview_state", { state });
}

export function stopRecording(): Promise<string> {
	analytics.capture("recording_stopped", {});
	return invoke<string>("stop_recording");
}

export function pauseRecording(): Promise<void> {
	return invoke<void>("pause_recording");
}

export function resumeRecording(): Promise<void> {
	return invoke<void>("resume_recording");
}

export function isRecordingPaused(): Promise<boolean> {
	return invoke<boolean>("is_recording_paused");
}

export function listRecasts(): Promise<RecordingEntry[]> {
	return invoke<RecordingEntry[]>("list_recasts");
}

export function listExports(): Promise<RecordingEntry[]> {
	return invoke<RecordingEntry[]>("list_exports");
}

//  Recast Cloud commands

/** Result of a successful cloud upload + share-link creation. */
export interface CloudShareResult {
	recastId: string;
	slug: string;
	shareUrl: string;
}

/** Local manifest entry: a local export that has a cloud copy. */
export interface CloudUploadRecord {
	recastId: string;
	slug: string;
	shareUrl: string;
	uploadedAt: number;
}

/**
 * Upload an already-exported MP4 to Recast Cloud and create a public share
 * link. The caller runs `exportVideo` first; `workspaceId` comes from the
 * desktop profile's `defaultWorkspaceId`. Emits `recast-cloud:progress`,
 * `recast-cloud:complete`, and `recast-cloud:error` events keyed by `path`.
 */
export function recastCloudUpload(
	path: string,
	title: string,
	workspaceId?: string,
): Promise<CloudShareResult> {
	return invoke<CloudShareResult>("recast_cloud_upload", { path, title, workspaceId });
}

/**
 * Update an existing share. Omit a field to leave it unchanged; for
 * `password` / `expiresAt`, pass "" to clear.
 */
export function recastCloudUpdateShare(
	slug: string,
	opts: {
		visibility?: "public" | "workspace" | "private";
		password?: string;
		expiresAt?: string;
	},
): Promise<void> {
	return invoke<void>("recast_cloud_update_share", {
		slug,
		visibility: opts.visibility,
		password: opts.password,
		expiresAt: opts.expiresAt,
	});
}

/** Delete the cloud copy (blob + row + shares). Never touches the local file. */
export function recastCloudDelete(recastId: string, path?: string): Promise<void> {
	return invoke<void>("recast_cloud_delete", { recastId, path });
}

/** List the shares for a recast (owner-only). Shape mirrors the web API. */
export function recastCloudListShares(recastId: string): Promise<unknown> {
	return invoke<unknown>("recast_cloud_list_shares", { recastId });
}

/** All locally-recorded cloud uploads, keyed by local export path. */
export function recastCloudListUploads(): Promise<Record<string, CloudUploadRecord>> {
	return invoke<Record<string, CloudUploadRecord>>("recast_cloud_list_uploads");
}

/** Drop a manifest entry (no network) — e.g. the local file moved. */
export function recastCloudForgetUpload(path: string): Promise<void> {
	return invoke<void>("recast_cloud_forget_upload", { path });
}

//  Editor commands

export function loadEditorDocument(path: string): Promise<EditorDocument> {
	return invoke<EditorDocument>("load_editor_document", { path });
}

export function generateThumbnails(path: string, count: number): Promise<string[]> {
	return invoke<string[]>("generate_thumbnails", { path, count });
}

export function getVideoMetadata(path: string): Promise<VideoMetadata> {
	return invoke<VideoMetadata>("get_video_metadata", { path });
}

export type ExportStateEvent =
	| { exportId: string; status: "started" }
	| { exportId: string; status: "progress"; progress: number }
	| { exportId: string; status: "finalizing" }
	| { exportId: string; status: "success"; path: string }
	| { exportId: string; status: "cancelled" }
	| { exportId: string; status: "error"; message: string };

const EXPORT_STATE_EVENT = "export-state";

export function createExportId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}

	return `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listenToExportState(
	exportId: string,
	onState: (event: ExportStateEvent) => void,
): Promise<() => void> {
	return listen<ExportStateEvent>(EXPORT_STATE_EVENT, (event) => {
		if (event.payload.exportId !== exportId) return;
		onState(event.payload);
	});
}

export interface ExportGifSettings {
	fps: number | null;
	quality: 'low' | 'medium' | 'high';
	loop: 'infinite' | 'once' | number;
	dither: 'bayer' | 'sierra2' | 'none';
}

export function exportVideo(
	inputPath: string,
	format: string,
	quality: string,
	renderState: EditorRenderState,
	exportId: string,
	gifSettings?: ExportGifSettings,
): Promise<string> {
	analytics.capture("export_started", { format, quality });
	return invoke<string>("export_video", {
		request: { exportId, inputPath, format, quality, renderState, gifSettings },
	});
}

/**
 * Signal any running export to abort. Causes `exportVideo` to reject with
 * `"export cancelled"`. Safe to call when no export is running.
 */
export function cancelExport(exportId: string): Promise<void> {
	return invoke("cancel_export", { exportId });
}

//  Zoom suggestions (auto-focus) 

export type ZoomSuggestionReason = "click" | "settleAfterMotion";

export interface ZoomSuggestion {
	timestampUs: number;
	x: number;
	y: number;
	reason: ZoomSuggestionReason;
	/** Confidence in [0,1] — how strongly this moment warrants a zoom. */
	score?: number;
}

/**
 * Analyse a captured cursor track and return candidate auto-focus moments
 * (clicks + settle-after-motion). Backed by `detect_zoom_triggers` in Rust.
 */
export function suggestZoomRegions(cursorPath: string): Promise<ZoomSuggestion[]> {
	return invoke<ZoomSuggestion[]>("suggest_zoom_regions", { cursorPath });
}

//  Silence detection

/** Tunable thresholds for `detectSilence`; omit any field to use the default. */
export interface SilenceDetectOptions {
	/**
	 * Frames must sit within this many dB of the recording's own noise floor
	 * to count as background. The floor is estimated per-recording, so this
	 * is relative to whatever level "background" sits at — a noisy room and a
	 * dead-quiet one both detect sensibly.
	 */
	flatnessDb?: number;
	/** Minimum continuous flat-audio run (seconds). */
	minAudioSilence?: number;
	/** Minimum length of a returned silence segment (seconds). */
	minSegment?: number;
}

/** A detected silence range, in original-recording seconds. */
export interface SilenceSegment {
	start: number;
	end: number;
	/** 0..1 — how strongly this range warrants a cut. */
	confidence: number;
	micSilent: boolean;
	systemSilent: boolean;
	/** Cursor track was present and confirmed idle over the range. */
	cursorIdle: boolean;
}

/**
 * Analyse a recording for silence — ranges where the audio envelope is flat
 * near its own noise floor AND the cursor isn't moving. Both constraints
 * must hold. Implementation lives in `silence.rs` (Rust).
 */
export function detectSilence(
	audioPath?: string | null,
	microphonePath?: string | null,
	cursorPath?: string | null,
	options?: SilenceDetectOptions,
): Promise<SilenceSegment[]> {
	return invoke<SilenceSegment[]>("detect_silence", {
		audioPath: audioPath ?? null,
		microphonePath: microphonePath ?? null,
		cursorPath: cursorPath ?? null,
		options: options ?? null,
	});
}

/**
 * Decode a recording's audio (mic + system mixed) into a compact peak
 * envelope — `buckets` normalised values in [0,1] — for drawing a waveform
 * on the timeline. Returns an empty array when the clip has no audio.
 */
export function extractWaveform(
	audioPath?: string | null,
	microphonePath?: string | null,
	buckets?: number,
): Promise<number[]> {
	return invoke<number[]>("extract_waveform", {
		audioPath: audioPath ?? null,
		microphonePath: microphonePath ?? null,
		buckets: buckets ?? null,
	});
}

//  Autosave / Recovery commands 

export function autosaveProject(projectPath: string, editsJson: string): Promise<void> {
	return invoke("autosave_project", { projectPath, editsJson });
}

/**
 * Persist the current edits back into the `.recast` archive. Returns the
 * save timestamp (unix ms) so the UI can show "Saved at HH:MM".
 */
export function saveProjectEdits(projectPath: string, editsJson: string): Promise<number> {
	return invoke<number>("save_project_edits", { projectPath, editsJson });
}

export function clearAutosave(projectPath: string): Promise<void> {
	return invoke("clear_autosave", { projectPath });
}

export function getRecoverableSessions(): Promise<AutosaveState[]> {
	return invoke<AutosaveState[]>("get_recoverable_sessions");
}

//  External asset cache 

export interface AssetInstallFailure {
	id: string;
	reason: string;
}

export interface HydratedAsset {
	id: string;
	path: string | null;
	thumbPath: string | null;
}

export interface AssetInstallResult {
	installed: string[];
	skipped: string[];
	failed: AssetInstallFailure[];
	cacheDir: string;
	hydrated: HydratedAsset[];
}

export function ensureAssetsInstalled(manifestUrl: string): Promise<AssetInstallResult> {
	return invoke<AssetInstallResult>("ensure_assets_installed", { manifestUrl });
}

export function getCachedAssetPath(id: string): Promise<string | null> {
	return invoke<string | null>("get_cached_asset_path", { id });
}

/** Read the on-disk manifest lock and return which assets are already cached.
 *  No network traffic — safe to call on offline launches before `ensure`. */
export function hydrateCachedAssets(): Promise<HydratedAsset[]> {
	return invoke<HydratedAsset[]>("hydrate_cached_assets");
}


// start recording
 export async function launchRecordingPanel() {
    const existing = await WebviewWindow.getByLabel("recording-panel");
    if (existing) {
      await existing.setFocus();
      return;
    }

    // Window is sized larger than the visible panel so the CSS drop shadow
    // has room to paint without being clipped by the window bounds.
    const panelWidth = 520;
    const panelHeight = 72;
    const panelWin = new WebviewWindow("recording-panel", {
      url: "/panel",
      title: "Recast Panel",
      width: panelWidth,
      height: panelHeight,
      decorations: false,
      transparent: true,
	  shadow: false,
      alwaysOnTop: !IS_LINUX,
      resizable: false,
      skipTaskbar: true,
      x: Math.round(window.screen.availWidth / 2 - panelWidth / 2),
      y: window.screen.availHeight - panelHeight - 40,
    });

    panelWin.once("tauri://error", (e) => console.error(e));
  }

// Floating webcam preview window. Mirrors `launchRecordingPanel` — same
// pattern (label-dedupe + Tauri error listener) so it stays consistent and we
// don't end up with route-level navigation when WebviewWindow construction
// fails silently.
//
// IMPORTANT: this window MUST be excluded from screen capture, otherwise
// DXGI Desktop Duplication captures it as part of the desktop and bakes
// the camera bubble into the recorded screen video. We invoke
// `exclude_window_from_capture` (Windows: SetWindowDisplayAffinity with
// WDA_EXCLUDEFROMCAPTURE) on the `tauri://created` event — earlier than
// that and the HWND isn't reachable yet.
export async function openCameraPreviewWindow() {
  const existing = await WebviewWindow.getByLabel("camera-preview");
  if (existing) {
    // Re-apply the exclusion in case the window was reused after a crash
    // or stop/restart cycle that dropped the affinity.
    invoke("exclude_window_from_capture", { label: "camera-preview" }).catch(
      (err) => console.warn("camera preview exclusion (existing) failed:", err),
    );
    await existing.setFocus();
    return;
  }

  const previewSize = 320;
  const previewWin = new WebviewWindow("camera-preview", {
    url: "/camera-preview",
    title: "Camera",
    width: previewSize,
    height: previewSize,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: !IS_LINUX,
    resizable: true,
    skipTaskbar: true,
    x: Math.round(window.screen.availWidth - previewSize - 40),
    y: Math.round(window.screen.availHeight - previewSize - 40),
  });

  previewWin.once("tauri://error", (e) => console.error(e));
  previewWin.once("tauri://created", async () => {
    try {
      await invoke("exclude_window_from_capture", {
        label: "camera-preview",
      });
    } catch (err) {
      // Non-fatal: the preview will still appear, but its pixels will
      // leak into screen captures. Surface to the console so users
      // diagnosing "why is my face in the recording?" can find it.
      console.warn(
        "Failed to exclude camera-preview from screen capture:",
        err,
      );
    }
  });
}
