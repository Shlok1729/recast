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
// Lazy, not a top-level `const` — calling `platform()` at module-eval time
// would make ipc.ts unsafe to *import* outside the Tauri webview (web build,
// SSR analysis). Several stores (gdrive/consent/diagnostics) import this module
// and guard actual calls behind `isTauriApp()`, so the module itself must be
// import-safe; `platform()` only runs when a window helper actually needs it.
const isLinux = () => platform() === "linux";

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
	/** Monitor refresh rate in Hz (rounded); 0 if the OS couldn't report it. */
	refreshHz: number;
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

/** One capture-input capability and whether this device's native API supports
 *  it. Mirrors the Rust `CaptureCapability` struct (`capture_capabilities`). */
/** Refines the `supported: false` case so the UI can say the right thing:
 *  `unsupported` → the OS can't do it; `planned` → we haven't shipped it yet. */
export type CapabilityStatus = "supported" | "unsupported" | "planned";

export interface CaptureCapability {
	/** "screen" | "window" | "region" | "systemAudio" | "microphone" |
	 *  "camera" | "cursor". */
	key: string;
	label: string;
	supported: boolean;
	/** Tri-state refinement of `supported` — see `CapabilityStatus`. */
	status: CapabilityStatus;
	/** Native API in use — e.g. "DXGI Desktop Duplication", "FFmpeg AVFoundation". */
	backend: string;
	note: string | null;
}

/** Capture-support matrix for the current OS. Mirrors the Rust
 *  `CaptureCapabilities` struct (`capture_capabilities`). */
export interface CaptureCapabilities {
	platform: string;
	screenBackend: string;
	capabilities: CaptureCapability[];
}

/** Report which capture inputs this device's native APIs support, computed
 *  from the running build's backend plus cheap runtime checks (macOS device
 *  listing, Linux session type). Powers Settings → "Capture support". */
export function captureCapabilities(): Promise<CaptureCapabilities> {
	return invoke<CaptureCapabilities>("capture_capabilities");
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
 * @param chromePx fixed, non-scaling vertical space (physical px) reserved at
 *   the bottom of the window for a control bar outside the video. The aspect
 *   applies to `height - chromePx`. Pass 0 for a video-only window.
 */
export function setWindowAspectRatio(
	label: string,
	aspectWidth: number,
	aspectHeight: number,
	maxScreenFraction: number,
	minWidthPx: number,
	chromePx: number,
): Promise<void> {
	return invoke("set_window_aspect_ratio", {
		label,
		aspectWidth,
		aspectHeight,
		maxScreenFraction,
		minWidthPx,
		chromePx,
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
	/** Capture frame rate. Omitted/out-of-range (24–240) → backend default 60. */
	fps?: number | null;
	/** Capture quality tier: "auto" (default — backend picks high on a hardware
	 *  encoder, balanced on software), or explicit "balanced"/"high"/"pristine". */
	quality?: "auto" | "balanced" | "high" | "pristine" | null;
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
	// No-op unless the user opted into product analytics. No PII — source kind,
	// capture rate, and quality tier only.
	analytics.capture("recording_started", {
		source_kind: targetType,
		fps: options?.fps ?? "default",
		quality: options?.quality ?? "auto",
	});
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

/** A single share link for a recast, as returned by `recast_cloud_list_shares`.
 *  The Rust command passes the server's JSON through verbatim (`serde_json::Value`),
 *  so this types the subset the manage UI actually consumes rather than the full
 *  server payload. `visibility` stays a `string` (not a union) because the server
 *  is the source of truth — the UI normalizes it with its own `toVisibility`. */
export interface CloudShareLink {
	slug: string;
	visibility: string;
	hasPassword: boolean;
	expiresAt: string | null;
	viewsCount: number;
}

/** Response of `recast_cloud_list_shares`. `shares` is absent on a recast that
 *  has no links yet. */
export interface CloudShareList {
	shares?: CloudShareLink[];
}

/** List the shares for a recast (owner-only). */
export function recastCloudListShares(recastId: string): Promise<CloudShareList> {
	return invoke<CloudShareList>("recast_cloud_list_shares", { recastId });
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

/** Encoder effort axis, orthogonal to `quality` (resolution). "balanced"
 *  reproduces the historical encoder settings exactly. */
export type ExportSpeed = "fast" | "balanced" | "quality";

export function exportVideo(
	inputPath: string,
	format: string,
	quality: string,
	renderState: EditorRenderState,
	exportId: string,
	gifSettings?: ExportGifSettings,
	speed: ExportSpeed = "balanced",
	/** Output frame rate for MP4/WebM. `null`/omitted keeps the source rate. */
	fps?: number | null,
): Promise<string> {
	analytics.capture("export_started", { format, quality, speed, fps: fps ?? "source" });
	return invoke<string>("export_video", {
		request: { exportId, inputPath, format, quality, speed, renderState, gifSettings, fps: fps ?? null },
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

//  Declarative asset-pack extensions

/** A manifest-local asset (downloaded + sha256-verified by the installer). */
export interface ExtensionAssetEntry {
	id: string;
	filename: string;
	url: string;
	sha256: string;
	size?: number | null;
	version?: string | null;
	thumbFilename?: string | null;
	thumbUrl?: string | null;
	thumbSha256?: string | null;
}

export interface ExtCursorContribution {
	id: string;
	label: string;
	description?: string;
	/** Manifest-local asset id of the rest-state SVG. */
	rest: string;
	/** Manifest-local asset id of the optional pressed-state (left-click) SVG. */
	press?: string;
	/** Manifest-local asset id of the optional right-click SVG. */
	rightPress?: string;
	/** Manifest-local asset id of the optional drag SVG. */
	drag?: string;
	hotspot: { x: number; y: number };
	pressedHotspot?: { x: number; y: number };
	rightPressedHotspot?: { x: number; y: number };
	dragHotspot?: { x: number; y: number };
}
export interface ExtBackgroundContribution {
	id: string;
	label: string;
	/** Manifest-local asset id of the full-resolution image. */
	asset: string;
	/** Optional manifest-local asset id of a thumbnail. */
	thumb?: string;
}
export interface ExtGradientContribution {
	id: string;
	label: string;
	/** CSS `linear-gradient(...)` string. */
	value: string;
}
export interface ExtColorContribution {
	id: string;
	label: string;
	/** Hex colour. */
	value: string;
}
export interface ExtEasingContribution {
	id: string;
	label: string;
	value: { x1: number; y1: number; x2: number; y2: number };
}
export interface ExtSmoothingContribution {
	id: string;
	label: string;
	smoothing: number;
	snapToClicks: boolean;
	snapWindowMs: number;
}

export interface ExtensionContributions {
	cursors?: ExtCursorContribution[];
	backgrounds?: ExtBackgroundContribution[];
	gradients?: ExtGradientContribution[];
	colors?: ExtColorContribution[];
	easings?: ExtEasingContribution[];
	smoothings?: ExtSmoothingContribution[];
}

export interface ExtensionManifest {
	id: string;
	name: string;
	version: string;
	author?: string | null;
	kind: string;
	permissions: string[];
	signature?: string | null;
	contributes: ExtensionContributions;
	assets: ExtensionAssetEntry[];
}

/** Resolved on-disk location for one manifest-local asset id. */
export interface ExtAssetPath {
	id: string;
	path: string | null;
	thumbPath: string | null;
}

export interface InstalledExtension {
	manifest: ExtensionManifest;
	enabled: boolean;
	dir: string;
	assets: ExtAssetPath[];
}

/** Install (or update) a pack from its manifest URL. Validates + sha256-verifies. */
export function installExtension(manifestUrl: string): Promise<InstalledExtension> {
	return invoke<InstalledExtension>("install_extension", { manifestUrl });
}

/** No-network enumeration of installed packs (for startup hydration). */
export function listInstalledExtensions(): Promise<InstalledExtension[]> {
	return invoke<InstalledExtension[]>("list_installed_extensions");
}

/** Toggle a pack's enabled flag without removing its files. */
export function setExtensionEnabled(extId: string, enabled: boolean): Promise<void> {
	return invoke<void>("set_extension_enabled", { extId, enabled });
}

/** Remove a pack and all of its files. */
export function uninstallExtension(extId: string): Promise<void> {
	return invoke<void>("uninstall_extension", { extId });
}

/** Fetch a curated registry *index* (no install) for the gallery. */
export function fetchExtensionRegistry<T = unknown>(indexUrl: string): Promise<T> {
	return invoke<T>("fetch_extension_registry", { indexUrl });
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
      alwaysOnTop: !isLinux(),
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
    excludeWindowFromCapture("camera-preview").catch(
      (err) => console.warn("camera preview exclusion (existing) failed:", err),
    );
    await existing.setFocus();
    return;
  }

  const previewSize = 320;
  // The window is the square video bubble plus a control strip below it. Keep
  // this strip height in sync with `CONTROL_BAR_HEIGHT` in
  // `routes/camera-preview/+page.svelte` so the window opens at the right size
  // and doesn't visibly resize itself once the aspect lock kicks in on mount.
  const CONTROL_BAR_HEIGHT = 40;
  const previewWin = new WebviewWindow("camera-preview", {
    url: "/camera-preview",
    title: "Camera",
    width: previewSize,
    height: previewSize + CONTROL_BAR_HEIGHT,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: !isLinux(),
    resizable: true,
    skipTaskbar: true,
    x: Math.round(window.screen.availWidth - previewSize - 40),
    y: Math.round(window.screen.availHeight - previewSize - CONTROL_BAR_HEIGHT - 40),
  });

  previewWin.once("tauri://error", (e) => console.error(e));
  previewWin.once("tauri://created", async () => {
    try {
      await excludeWindowFromCapture("camera-preview");
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

//  System tray, diagnostics & misc commands
//
// Primitive-typed one-offs that previously called `invoke()` raw from scattered
// stores/components. Routed here so the whole IPC surface is typed in one place
// (see the module header). Callers in web-safe stores still guard with
// `isTauriApp()` before calling — these wrappers don't, they're thin.

/** Exclude a window (by Tauri label) from screen capture (Windows
 *  `SetWindowDisplayAffinity`). No-op on platforms without an equivalent. */
export function excludeWindowFromCapture(label: string): Promise<void> {
	return invoke<void>("exclude_window_from_capture", { label });
}

/** Refresh the system tray menu/icon. `isRecording` overrides the recording
 *  state shown; `null`/omitted lets the backend resolve it. */
export function refreshTray(isRecording?: boolean | null): Promise<void> {
	return invoke<void>("refresh_tray", { isRecording: isRecording ?? null });
}

/** Whether closing the main window hides to tray instead of quitting. */
export function getCloseToTray(): Promise<boolean> {
	return invoke<boolean>("get_close_to_tray");
}

export function setCloseToTray(enabled: boolean): Promise<void> {
	return invoke<void>("set_close_to_tray", { enabled });
}

/** Open the app's log directory in the OS file manager; returns the path. */
export function openLogDir(): Promise<string> {
	return invoke<string>("open_log_dir");
}

/** Consume a file path the OS asked us to open (file association / deep link),
 *  if one is pending. Returns `null` when there's nothing queued. */
export function takePendingOpenFile(): Promise<string | null> {
	return invoke<string | null>("take_pending_open_file");
}

/** Whether a capture session is currently active (recording or paused). */
export function isRecordingActive(): Promise<boolean> {
	return invoke<boolean>("is_recording_active");
}

/** Persist the user's telemetry consent. `installId` seeds a fresh anonymous
 *  id when product analytics is first enabled. */
export function setTelemetryConsent(
	product: boolean,
	errors: boolean,
	installId?: string,
): Promise<void> {
	return invoke<void>("set_telemetry_consent", { product, errors, installId });
}

/** Whether verbose diagnostic logging is enabled. */
export function getDiagnosticLogging(): Promise<boolean> {
	return invoke<boolean>("get_diagnostic_logging");
}

export function setDiagnosticLogging(enabled: boolean): Promise<void> {
	return invoke<void>("set_diagnostic_logging", { enabled });
}

//  Recast Cloud — account / auth
//
// Canonical shapes for the `auth_*` and cloud-endpoint commands. These live
// here (not in the cloud stores) so the IPC contract has one home; the stores
// import these types + the wrappers below. All are `#[serde(rename_all =
// "camelCase")]` on the Rust side EXCEPT `AuthStartResult` (noted inline).

export interface AuthPlan {
	id: string;
	name: string;
	status: string;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
}

export interface AuthUsage {
	recordings: number;
	storageBytes: number;
	activeShares: number;
	sharesLimit: number | null;
}

/** A workspace the signed-in user can upload into. Mirrors the Rust `Workspace`. */
export interface CloudWorkspace {
	id: string;
	name: string;
	/** "owner" | "admin" | "member". */
	role: string;
	/** "free" | "pro" | "enterprise" — the org's plan. */
	plan: string;
	/** Live (non-deleted) recast count in the workspace. */
	recastsCount: number;
}

/** Full sign-in snapshot from `auth_status`. Consumers read the subset they
 *  need (profile card vs. share-flow guard). */
export interface AuthStatus {
	signedIn: boolean;
	email: string | null;
	name: string | null;
	image: string | null;
	memberSince: string | null;
	plan: AuthPlan | null;
	usage: AuthUsage | null;
	workspaces: CloudWorkspace[];
	defaultWorkspaceId: string | null;
}

/** Result of `auth_start` (device-authorization flow kickoff). NOTE: the Rust
 *  `AuthStartResult` is NOT `rename_all = camelCase`, so its fields stay
 *  snake_case on the wire. */
export interface AuthStartResult {
	user_code: string;
	verification_uri: string;
	expires_in: number;
}

/** Self-hosting cloud endpoint config (`get_cloud_api_config` / `set_cloud_api_url`). */
export interface CloudApiConfig {
	effective: string;
	overrideUrl: string | null;
	defaultUrl: string;
	isCustom: boolean;
}

export function authStatus(): Promise<AuthStatus> {
	return invoke<AuthStatus>("auth_status");
}

export function authStart(): Promise<AuthStartResult> {
	return invoke<AuthStartResult>("auth_start");
}

export function authSignOut(): Promise<void> {
	return invoke<void>("auth_sign_out");
}

export function authCancel(): Promise<void> {
	return invoke<void>("auth_cancel");
}

export function getCloudApiConfig(): Promise<CloudApiConfig> {
	return invoke<CloudApiConfig>("get_cloud_api_config");
}

/** Set (or clear, with `null`) the self-hosting endpoint override. Returns the
 *  resolved config; the backend validates and falls back to the default. */
export function setCloudApiUrl(url: string | null): Promise<CloudApiConfig> {
	return invoke<CloudApiConfig>("set_cloud_api_url", { url });
}

//  Google Drive
//
// Types + wrappers for the `gdrive_*` commands (OAuth + Drive upload). The
// gdrive store guards every call with `isTauriApp()` and tracks in-flight UI
// state itself; these wrappers are thin.

export interface GdriveStatus {
	connected: boolean;
	email?: string | null;
}

/** Result of a successful Drive upload. */
export interface GdriveUploadResult {
	fileId: string;
	name: string;
	webViewLink?: string;
}

/** Persisted record of a prior Drive upload, keyed by local export path.
 *  Mirrors the Rust `UploadRecord` from `commands/gdrive.rs`. */
export interface GdriveUploadRecord {
	fileId: string;
	name: string;
	webViewLink?: string;
	/** Unix seconds. */
	uploadedAt: number;
}

export function gdriveStatus(): Promise<GdriveStatus> {
	return invoke<GdriveStatus>("gdrive_status");
}

export function gdriveListUploads(): Promise<Record<string, GdriveUploadRecord>> {
	return invoke<Record<string, GdriveUploadRecord>>("gdrive_list_uploads");
}

export function gdriveConnect(): Promise<void> {
	return invoke<void>("gdrive_connect");
}

export function gdriveDisconnect(): Promise<void> {
	return invoke<void>("gdrive_disconnect");
}

export function gdriveUpload(path: string, uploadId: string): Promise<GdriveUploadResult> {
	return invoke<GdriveUploadResult>("gdrive_upload", { path, uploadId });
}

export function gdriveCancelUpload(uploadId: string): Promise<void> {
	return invoke<void>("gdrive_cancel_upload", { uploadId });
}

export function gdriveForgetUpload(localPath: string): Promise<void> {
	return invoke<void>("gdrive_forget_upload", { localPath });
}

/** Validate a `.recast` project file, throwing if it isn't a readable, valid
 *  project. Used purely as a guard before opening — the backend returns the
 *  project metadata, but no caller surfaces it, so it's intentionally not typed
 *  out here (kept as `void`). */
export function peekRecastProject(path: string): Promise<void> {
	return invoke<void>("peek_recast_project", { path });
}
