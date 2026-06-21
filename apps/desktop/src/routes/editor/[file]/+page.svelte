<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import EditorToolbar from "$components/editor/EditorToolbar.svelte";
  import ExportDialog from "$components/editor/ExportDialog.svelte";
  import ExportFlowDialog, {
    type ExportFlowPhase,
  } from "$components/editor/ExportFlowDialog.svelte";
  import PropertiesPanel from "$components/editor/properity-panel/PropertiesPanel.svelte";
  import Timeline from "$components/editor/Timeline.svelte";
  import VideoPlayerControls from "$components/editor/VideoPlayerControls.svelte";
  import VideoPreview from "$components/editor/VideoPreview.svelte";
  import CustomTitlebar from "$components/layout/custom-titlebar.svelte";
  import EditorSkeleton from "$components/skeletons/EditorSkeleton.svelte";
  import type { ExportStateEvent } from "$lib/ipc";
  import {
    autosaveProject,
    cancelExport,
    clearAutosave,
    createExportId,
    extractWaveform,
    generateThumbnails,
    loadEditorDocument,
    openFileLocation,
    refreshTray,
    saveProjectEdits,
  } from "$lib/ipc";
  import { generateAutoZoom } from "$lib/services/analysis";
  import { buildExportRenderState, runExport } from "$lib/services/export";
  import { isShareSupported, shareRecording } from "$lib/share";
  import { registerShortcutHandlers } from "$lib/shortcuts/registry.svelte";
  import { cloudShare } from "$lib/stores/cloudShare.svelte";
  import {
    createEditorStore,
    type VideoMetadata,
  } from "$lib/stores/editor-store.svelte";
  import { experimentalStore } from "$lib/stores/experimental.svelte";
  import { gdrive } from "$lib/stores/gdrive.svelte";
  import {
    ArrowLeft,
    CheckCircle2,
    Circle,
    Cloud,
    ExternalLink,
    FlaskConical,
    FolderOpen,
    HardDriveUpload,
    Link2,
    LoaderCircle,
    RefreshCw,
    Scissors,
    Share2,
    TriangleAlert,
    Upload,
    VolumeX,
    X,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { Kbd } from "@recast/ui/kbd";
  import { toast } from "@recast/ui/sonner";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onDestroy, onMount, tick, untrack } from "svelte";

  import { log } from "$lib/logger";
  import { cubicOut } from "svelte/easing";
  import { fade, slide } from "svelte/transition";

  interface Props {
    data: {
      filePath: string;
      filename: string;
    };
  }

  let { data }: Props = $props();

  const store = createEditorStore();

  let videoEl: HTMLVideoElement | null = $state(null);
  // True while the WebCodecs preview engine drives the picture (its output-time
  // clock owns `store.currentTime`). When set, `handleTimeUpdate` must NOT echo
  // `videoEl.currentTime` back into the store: the `<video>` element free-runs
  // through the raw (un-cut) recording, so feeding its time to the store fights
  // the clock and snaps playback back across a cut. Bound from VideoPreview.
  let webcodecsActive = $state(false);
  // VideoPreview binds its `captureFrame` to this slot so VideoPlayerControls
  // can trigger a WYSIWYG screenshot (composite, not raw video frame).
  let captureFrame = $state<(() => Promise<Blob | null>) | undefined>(undefined);
  // Loop-within-trim toggle. Lives here (not inside VideoPlayerControls)
  // because both the `ended` and `timeupdate` paths to "we hit the end"
  // need to be handled in this file — `handleVideoEnded` already coordinates
  // audio elements, and we want one source of truth for "what happens at
  // the end of the clip" (pause vs. loop).
  let loopEnabled = $state(false);

  // Editor layout — VS Code/Cursor-style toggles for the right properties
  // panel and the bottom timeline. Persisted so the choice survives reloads;
  // a missing or malformed key falls back to "everything visible".
  const LAYOUT_KEY = "recast-editor-layout";
  function loadLayout(): { sidebar: boolean; timeline: boolean } {
    const fallback = { sidebar: true, timeline: true };
    if (!browser) return fallback;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<typeof fallback>;
      return {
        sidebar:
          typeof parsed?.sidebar === "boolean" ? parsed.sidebar : true,
        timeline:
          typeof parsed?.timeline === "boolean" ? parsed.timeline : true,
      };
    } catch {
      return fallback;
    }
  }
  const initialLayout = loadLayout();
  let showSidebar = $state(initialLayout.sidebar);
  let showTimeline = $state(initialLayout.timeline);

  $effect(() => {
    if (!browser) return;
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({ sidebar: showSidebar, timeline: showTimeline }),
      );
    } catch {
      // localStorage can throw in private-mode/quota edge cases — the toggle
      // still works for the session, it just won't be remembered.
    }
  });

  let previewContainerEl: HTMLDivElement | null = $state(null);
  let systemAudioEl: HTMLAudioElement | null = $state(null);
  let micAudioEl: HTMLAudioElement | null = $state(null);
  let videoSrc = $state("");
  let systemAudioSrc = $state("");
  let micAudioSrc = $state("");
  let cursorPath = $state<string | null>(null);
  let cameraPath = $state<string | null>(null);
  let cameraSrc = $state("");
  let documentPath = $state("");
  let isLoading = $state(true);
  let error = $state("");
  let loadedPath = $state("");
  let thumbnailToken = 0;

  // Autosave: save edit state every 30 seconds while editing.
  const AUTOSAVE_INTERVAL_MS = 30_000;
  let autosaveTimer: ReturnType<typeof setInterval> | null = null;

  function startAutosave() {
    stopAutosave();
    autosaveTimer = setInterval(async () => {
      if (!documentPath || isLoading) return;
      try {
        const editsJson = JSON.stringify(store.toRenderState());
        await autosaveProject(documentPath, editsJson);
      } catch (err) {
        console.warn("Autosave failed:", err);
      }
    }, AUTOSAVE_INTERVAL_MS);
  }

  function stopAutosave() {
    if (autosaveTimer !== null) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  }

  onDestroy(() => {
    stopAutosave();
    log.clearRecast();
    // Clear autosave on clean exit.
    if (documentPath) {
      clearAutosave(documentPath).catch(() => {});
    }
  });

  /** Seek the video (+ audio tracks) back to `trimStart` and resume playback.
   *  Used by both loop paths — `timeupdate` (catches trimEnd < duration)
   *  and `ended` (catches the natural end where timeupdate may have
   *  missed its ~40 ms window thanks to Chromium's ~250 ms timeupdate
   *  cadence). Returns true if it actually wrapped, so the timeupdate
   *  handler can short-circuit further work on the same tick. */
  function loopBackToStart(): boolean {
    if (!videoEl) return false;
    const start = store.trimStart || 0;
    videoEl.currentTime = start;
    for (const el of [systemAudioEl, micAudioEl]) {
      if (el) el.currentTime = start;
    }
    // play() can reject if the browser thinks user-gesture is required —
    // unlikely here since we're chaining off an existing play, but log
    // it instead of silently stalling.
    void videoEl.play().catch((err) => {
      console.warn("loop replay failed:", err);
    });
    store.isPlaying = true;
    return true;
  }

  function handleTimeUpdate() {
    if (!videoEl) return;
    if (store.isPlaying) {
      // In the WebCodecs path the picture clock is the master and owns
      // `store.currentTime`, and audio is slaved to it by `syncAudioToClock`
      // (rAF) — NOT to this `<video>` element. The element free-runs through the
      // raw recording (it doesn't skip cuts), so echoing its time into the store,
      // running the trim-loop off it, or snapping audio to it all fight the clock
      // and yank playback/audio back across a cut. Everything below is therefore
      // legacy-`<video>`-path only; the clock path handles time, end/loop, and
      // audio elsewhere.
      if (webcodecsActive) return;
      store.currentTime = videoEl.currentTime;
      // Loop within trim region. Only relevant when trimEnd is set BELOW
      // the natural duration — at the natural end we rely on the `ended`
      // event below, which is more precise than timeupdate's ~250 ms tick.
      if (loopEnabled && store.metadata) {
        const trimEnd = store.trimEnd > 0 ? store.trimEnd : store.metadata.duration;
        if (trimEnd > 0 && trimEnd < store.metadata.duration - 0.05) {
          if (videoEl.currentTime >= trimEnd - 0.05) {
            loopBackToStart();
            return;
          }
        }
      }
      // Cheap drift correction: if audio elements drift > 150ms from video, snap them back.
      const videoT = videoEl.currentTime;
      for (const el of [systemAudioEl, micAudioEl]) {
        if (el && !el.paused && Math.abs(el.currentTime - videoT) > 0.15) {
          el.currentTime = videoT;
        }
      }
    }
  }

  function handleVideoEnded() {
    // Loop wins over the default "stop at end" — restart from trimStart
    // and keep audio tracks rolling. Without this short-circuit the
    // pause + audio.pause() calls below would race with loopBackToStart
    // and the audio $effect (watching `isPlaying`) might batch the
    // false→true transition out of existence, leaving audio paused
    // while video plays.
    if (loopEnabled && videoEl) {
      loopBackToStart();
      return;
    }
    store.isPlaying = false;
    systemAudioEl?.pause();
    micAudioEl?.pause();
  }

  // Slave the audio tracks to the picture clock (WebCodecs path). The audio WAVs
  // are the FULL recording, so to play the edited timeline they must skip the
  // same cuts the picture does: `store.currentTime` is the cut-aware playhead the
  // draw loop publishes, so we snap each element onto it whenever it drifts past
  // a threshold. Normal playback runs both at 1× so they stay locked with no
  // correction; the only correction is one snap at each cut boundary (where
  // `store.currentTime` jumps the cut's length) and on a seek — exactly the
  // events the old `<video>`-slaving handled late/twice, which is what made audio
  // lag and repeat. Tighter than the visual threshold since audio desync is more
  // audible, but not so tight that per-frame jitter causes constant re-seeks.
  const AUDIO_SYNC_THRESHOLD = 0.12;
  let audioSyncRaf: number | null = null;
  function syncAudioToClock() {
    audioSyncRaf = requestAnimationFrame(syncAudioToClock);
    if (!store.isPlaying || !webcodecsActive) return;
    const target = store.currentTime;
    for (const el of [systemAudioEl, micAudioEl]) {
      if (!el || el.paused) continue;
      if (Math.abs(el.currentTime - target) > AUDIO_SYNC_THRESHOLD) {
        el.currentTime = target;
      }
    }
  }
  function startAudioClockSync() {
    if (audioSyncRaf === null) audioSyncRaf = requestAnimationFrame(syncAudioToClock);
  }
  function stopAudioClockSync() {
    if (audioSyncRaf !== null) {
      cancelAnimationFrame(audioSyncRaf);
      audioSyncRaf = null;
    }
  }
  onDestroy(stopAudioClockSync);

  // Play/pause audio elements in lockstep with the video via the store's
  // `isPlaying` flag (which is set by PlaybackControls, keyboard handler, etc.).
  $effect(() => {
    const playing = store.isPlaying;
    // In the WebCodecs path the clock owns the time; align to it, not to the
    // free-running <video> element. Read untracked so this effect doesn't re-run
    // (re-aligning + replaying audio) on every clock tick.
    const alignTo = untrack(() =>
      webcodecsActive ? store.currentTime : (videoEl?.currentTime ?? 0),
    );
    for (const el of [systemAudioEl, micAudioEl]) {
      if (!el) continue;
      if (playing) {
        // Align audio to the current playhead before resuming.
        el.currentTime = alignTo;
        void el.play().catch((err) => {
          console.warn("Audio play failed:", err);
        });
      } else {
        el.pause();
      }
    }
    // Keep audio locked to the clock while playing on the WebCodecs path.
    if (playing && webcodecsActive) startAudioClockSync();
    else stopAudioClockSync();
  });

  // Apply volume/mute from the store's audio settings to both audio elements.
  $effect(() => {
    const settings = store.audioSettings;
    const vol = settings.muted
      ? 0
      : Math.max(0, Math.min(1, settings.volume / 100));
    if (systemAudioEl) systemAudioEl.volume = vol;
    if (micAudioEl) micAudioEl.volume = vol;
  });

  // Snap audio to the video's time whenever the user scrubs. WebCodecs path:
  // audio follows the clock (`syncAudioToClock`), and the `<video>` element gets
  // seeked by its own transport-correction (to a cut-aware time, but mid-stream),
  // so snapping audio to those events would fight the clock and reintroduce the
  // lag/repeat. Skip it there — paused-scrub audio realigns on the next play via
  // the play/pause effect.
  function handleVideoSeeked() {
    if (!videoEl || webcodecsActive) return;
    const t = videoEl.currentTime;
    for (const el of [systemAudioEl, micAudioEl]) {
      if (el) el.currentTime = t;
    }
  }

  function mergeVideoMetadata(next: Partial<VideoMetadata>) {
    store.metadata = {
      duration: next.duration ?? store.metadata?.duration ?? 0,
      width: next.width ?? store.metadata?.width ?? 0,
      height: next.height ?? store.metadata?.height ?? 0,
      fps: next.fps ?? store.metadata?.fps ?? 30,
      codec: next.codec ?? store.metadata?.codec ?? "unknown",
      sizeBytes: next.sizeBytes ?? store.metadata?.sizeBytes ?? 0,
    };
    if (store.trimEnd <= 0 && store.metadata.duration > 0) {
      store.loadRenderState({ trimEnd: store.metadata.duration });
    }
  }

  async function loadThumbnailStrip(path: string) {
    // Skip when we don't have a usable duration yet — bumping the token
    // would cancel any genuinely in-flight strip, and generateThumbnails
    // against a 0-duration source just yields black frames.
    const duration = store.metadata?.duration ?? 0;
    if (duration <= 0) return;

    const token = ++thumbnailToken;
    try {
      const count = duration > 60 ? 12 : 8;
      const strip = await generateThumbnails(path, count);
      if (token === thumbnailToken) {
        store.thumbnailStrip = strip;
      }
    } catch (err) {
      console.error("Thumbnail generation failed", err);
      if (token === thumbnailToken) {
        store.thumbnailStrip = [];
      }
    }
  }

  // Decode the audio peak envelope for the timeline waveform. Best-effort
  // and fully async — the editor is usable before it resolves.
  async function loadWaveform() {
    // Sub-5s clips don't benefit from a waveform strip — the timeline is
    // too narrow to show anything readable, and the FFmpeg pass to decode
    // peaks costs more than the result is worth at that scale.
    const duration = store.metadata?.duration ?? 0;
    if (duration > 0 && duration < 5) {
      store.waveform = [];
      return;
    }
    try {
      store.waveform = await extractWaveform(
        store.audioPath,
        store.microphonePath,
      );
    } catch (err) {
      console.warn("Waveform extraction failed", err);
      store.waveform = [];
    }
  }

  function handleVideoLoadedMetadata() {
    if (!videoEl) return;
    mergeVideoMetadata({
      duration: videoEl.duration,
      width: videoEl.videoWidth,
      height: videoEl.videoHeight,
    });
  }

  function handleVideoReady() {
    handleVideoLoadedMetadata();
    isLoading = false;
    startAutosave();
  }

  function handleVideoError() {
    const code = videoEl?.error?.code;
    error = code
      ? `Failed to load source media (media error ${code}).`
      : "Failed to load source media.";
    isLoading = false;
  }

  async function loadDocument() {
    error = "";
    isLoading = true;
    videoSrc = "";
    systemAudioSrc = "";
    micAudioSrc = "";
    cursorPath = null;
    cameraPath = null;
    cameraSrc = "";
    videoEl?.pause();
    systemAudioEl?.pause();
    micAudioEl?.pause();
    store.metadata = null;
    store.reset();
    store.thumbnailStrip = [];

    try {
      const document = await loadEditorDocument(data.filePath);
      documentPath = document.projectPath;
      store.videoPath = document.projectPath;
      store.metadata = document.metadata;
      store.loadRenderState(document.renderState);
      // Scope every subsequent log in this window to the opened recast.
      log.setRecast(documentPath, {
        width: document.metadata.width,
        height: document.metadata.height,
        durationSec: Math.round(document.metadata.duration),
        fps: document.metadata.fps,
        codec: document.metadata.codec,
      });
      void loadThumbnailStrip(document.projectPath);
      videoSrc = convertFileSrc(document.mediaPath);
      cursorPath = document.cursorPath ?? null;
      store.cursorPath = cursorPath;
      // Raw on-disk media paths for Rust-side analysis (silence detection).
      store.recordingPath = document.mediaPath;
      store.audioPath = document.audioPath ?? null;
      store.microphonePath = document.microphonePath ?? null;
      store.waveform = [];
      // Waveform decode is only consumed by the cut lane (experimental).
      // Skip the ffmpeg roundtrip when the feature is off; the $effect below
      // back-fills it if the user flips the flag on later.
      if (experimentalStore.silenceDetection) void loadWaveform();
      systemAudioSrc = document.audioPath
        ? convertFileSrc(document.audioPath)
        : "";
      micAudioSrc = document.microphonePath
        ? convertFileSrc(document.microphonePath)
        : "";
      cameraPath = document.cameraPath ?? null;
      cameraSrc = cameraPath ? convertFileSrc(cameraPath) : "";
      // Mount the editor body so the <video> element exists before we call load().
      // The video element lives inside VideoPreview, which only renders when !isLoading.
      isLoading = false;
      await tick();
      videoEl?.load();
      systemAudioEl?.load();
      micAudioEl?.load();
      void maybeRunAutoZoom();
    } catch (err) {
      console.error("Failed to load editor document", err);
      log.error("session", "recast_load_failed", { error: String(err) });
      error = `Could not load project: ${err}`;
      isLoading = false;
    }
  }

  // Smart Auto-Zoom: on the first load of a recording, place a focus region
  // at every detected click + settle-after-motion. Persisted via the
  // `autoZoomApplied` flag on the project document so subsequent reopens
  // don't repopulate (the user may have intentionally cleared regions).
  let autoZoomRunning = false;

  async function maybeRunAutoZoom() {
    if (autoZoomRunning) return;
    if (!store.autoZoomEnabled || store.autoZoomApplied) return;
    if (!cursorPath) {
      // Screen-only recording with no cursor track to analyse — latch the
      // flag so we don't retry every reopen.
      store.autoZoomApplied = true;
      return;
    }
    if (store.zoomRegions.length > 0) {
      // Project already has regions (autosave restored them, or the user
      // added some manually before the auto-apply ran). Skip silently.
      store.autoZoomApplied = true;
      return;
    }
    await runAutoZoom({ silentEmpty: true });
  }

  async function runAutoZoom(opts: { silentEmpty?: boolean } = {}) {
    if (autoZoomRunning) return;
    if (!cursorPath) return;
    autoZoomRunning = true;
    try {
      // generateAutoZoom latches store.autoZoomApplied itself (it's persisted
      // document state) on all non-error paths, before its own autosave.
      const outcome = await generateAutoZoom(store, cursorPath, {
        documentPath,
      });
      if (outcome.reason === "bad-bounds") return;
      if (outcome.applied > 0) {
        toast.success(
          `Added ${outcome.applied} focus moment${outcome.applied === 1 ? "" : "s"}`,
          {
            description: "Tweak, remove, or turn off in the Focus panel.",
            action: {
              label: "Undo",
              onClick: () => {
                store.clearAutoZooms();
                store.autoZoomApplied = false;
              },
            },
          },
        );
      } else if (!opts.silentEmpty) {
        toast.info("No focus candidates found");
      }
    } catch (err) {
      console.warn("Auto-zoom failed:", err);
    } finally {
      autoZoomRunning = false;
    }
  }

  // Re-run is exposed to FocusPanel via a typed CustomEvent on `window` so
  // the deeply-nested panel doesn't need to thread a prop through every
  // intermediate component.
  $effect(() => {
    function onRerun() {
      store.clearAutoZooms();
      store.autoZoomApplied = false;
      void runAutoZoom({ silentEmpty: false });
    }
    window.addEventListener("recast:rerun-auto-zoom", onRerun);
    return () => window.removeEventListener("recast:rerun-auto-zoom", onRerun);
  });

  // Export lifecycle UI state — lives in the route, not the store, because the
  // overlay handles success/cancel/error reveals that don't belong in global state.
  let exportStartedAt = $state<number>(0);
  let exportNow = $state<number>(Date.now());
  let exportCancelling = $state(false);
  let exportFinalizing = $state(false);
  let exportHasProgress = $state(false);
  let activeExportId = $state<string | null>(null);


  // Rotating, encode-themed status messages shown below the progress ring —
  // gives the wait some personality (à la an AI assistant's "thinking" line).
  const ENCODE_MESSAGES = [
    "Crunching frames",
    "Encoding pixels",
    "Weaving the timeline",
    "Tuning the colours",
    "Squeezing the bitrate",
    "Polishing every frame",
  ];
  let encodeMessageIndex = $state(0);

  // Preparing-stage substages — surfaced in the dialog so users see the
  // hybrid-raster work happening rather than a generic spinner.
  let prepText = $state<"pending" | "running" | "done">("pending");
  let prepCursor = $state<"pending" | "running" | "done">("pending");
  let prepSending = $state<"pending" | "running" | "done">("pending");
  function resetPrep() {
    prepText = "pending";
    prepCursor = "pending";
    prepSending = "pending";
  }

  // Eased display percentage. Raw FFmpeg progress is jumpy (5–10% jumps,
  // sticky around 99%), so we lerp the rendered ring toward it with a
  // cubic-bezier-like response. Rerun on every animation tick while
  // exporting so the ring never sits stale.
  let displayPct = $state(0);
  let easeRafHandle: number | null = null;
  $effect(() => {
    if (!store.isExporting) {
      if (easeRafHandle !== null) {
        cancelAnimationFrame(easeRafHandle);
        easeRafHandle = null;
      }
      displayPct = 0;
      return;
    }
    let lastTs: number | null = null;
    function tick(now: number) {
      const target = exportFinalizing
        ? 99.5
        : Math.min(99.5, Math.max(0, store.exportProgress ?? 0));
      const dt = lastTs === null ? 16 : Math.max(1, Math.min(64, now - lastTs));
      lastTs = now;
      // Critically-damped follower with a ~250 ms time constant. The
      // exponential form is shape-equivalent to a cubic-bezier-ease-out
      // toward `target` and avoids overshoot at the high end.
      const tau = 250;
      const k = 1 - Math.exp(-dt / tau);
      const next = displayPct + (target - displayPct) * k;
      // Don't animate backwards on micro-jitter; the underlying export is
      // monotonic so the ring should feel monotonic too.
      displayPct = Math.max(displayPct, next);
      easeRafHandle = requestAnimationFrame(tick);
    }
    easeRafHandle = requestAnimationFrame(tick);
    return () => {
      if (easeRafHandle !== null) {
        cancelAnimationFrame(easeRafHandle);
        easeRafHandle = null;
      }
    };
  });

  function renderStateHasText(): boolean {
    return store.annotations.some((a) => a.kind.kind === "text");
  }

  // ETA — only meaningful once we have ≥10% real progress. Computed from
  // wall-clock-elapsed × (1 − pct) / pct, smoothed by the same ring follower.
  function exportEtaMs(): number | null {
    if (!exportHasProgress || exportFinalizing) return null;
    const pct = store.exportProgress ?? 0;
    if (pct < 10) return null;
    const elapsed = exportNow - exportStartedAt;
    if (elapsed < 250) return null;
    return (elapsed * (100 - pct)) / pct;
  }

  let exportResult = $state<
    | { kind: "success"; path: string }
    | { kind: "cancelled" }
    | { kind: "error"; message: string }
    | null
  >(null);

  function setExportResult(next: NonNullable<typeof exportResult>) {
    let alreadySame = false;
    if (exportResult?.kind === next.kind) {
      if (next.kind === "success" && exportResult.kind === "success") {
        alreadySame = exportResult.path === next.path;
      } else if (next.kind === "error" && exportResult.kind === "error") {
        alreadySame = exportResult.message === next.message;
      } else if (
        next.kind === "cancelled" &&
        exportResult.kind === "cancelled"
      ) {
        alreadySame = true;
      }
    }
    if (alreadySame) return;

    exportResult = next;
    exportFinalizing = false;
    exportCancelling = false;

    if (next.kind === "success") {
      toast.success("Export complete");
      // Refresh the tray's Recent Exports submenu so this export is
      // selectable from there immediately. Pass `isRecording: null` to
      // signal "list changed, don't touch the recording flag" — the
      // panel window is the authoritative source for that.
      void refreshTray(null).catch(() => {});
    } else if (next.kind === "cancelled") {
      toast.info("Export cancelled");
    } else {
      toast.error("Export failed");
    }
  }

  function handleExportState(event: ExportStateEvent) {
    switch (event.status) {
      case "started":
        return;
      case "progress": {
        const next = Math.min(Math.max(event.progress, 0), 100);
        const current = store.exportProgress ?? 0;

        // FFmpeg progress gets noisy near the end on some Windows builds.
        // Keep the UI monotonic and ignore sub-tenth-percent jitter so the
        // progress bar does not flicker around 99%.
        if (!exportHasProgress || next >= 100 || next > current + 0.1) {
          store.exportProgress = Math.max(current, next);
        }
        exportHasProgress = true;
        // Previously this block speculatively flipped the UI to "finalizing"
        // at ≥99.5% raw progress, on the assumption that stderr pipe batching
        // was hiding the real `progress=end`. With `-progress pipe:2
        // -stats_period 0.1` the Rust side now emits a real `finalizing`
        // event within ~100ms of ffmpeg's actual finish, so the speculative
        // flip was just mislabelling the last second of active encoding as
        // "Writing video file…". Only a very-near-end safety net remains
        // below as a last-resort for the rare case where the `finalizing`
        // event is dropped entirely.
        if (!exportFinalizing && next >= 99.95) {
          exportFinalizing = true;
        }
        return;
      }
      case "finalizing":
        exportFinalizing = true;
        return;
      case "success":
        setExportResult({ kind: "success", path: event.path });
        return;
      case "cancelled":
        setExportResult({ kind: "cancelled" });
        return;
      case "error":
        setExportResult({ kind: "error", message: event.message });
        return;
    }
  }

  async function handleExport() {
    if (store.isExporting) return;
    const exportId = createExportId();
    store.isExporting = true;
    store.exportProgress = 0;
    exportHasProgress = false;
    exportCancelling = false;
    exportFinalizing = false;
    activeExportId = exportId;
    exportResult = null;
    exportStartedAt = Date.now();
    exportNow = exportStartedAt;
    resetPrep();

    try {
      // Build the exact payload Rust renders: hybrid-raster passes (text →
      // PNG, cursor → sprite sheet) plus per-lane enable toggles. The prep
      // sub-stages drive the "Preparing…" UI via these hooks.
      const { renderState: finalRenderState, metadata: meta } =
        await buildExportRenderState(store, {
          hooks: {
            onText: (s) => (prepText = s),
            onCursor: (s) => (prepCursor = s),
            onSending: (s) => (prepSending = s),
          },
        });

      // Capture the exact settings this export ran with — the single most
      // useful line when a user reports "my export looked wrong".
      log.info("export", "export_started", {
        exportId,
        format: store.exportFormat,
        quality: store.exportQuality,
        speed: store.exportSpeed,
        gif: store.exportFormat === "gif" ? store.gifSettings : undefined,
        annotations: finalRenderState.annotations.length,
        zoomRegions: finalRenderState.zoomRegions.length,
        cuts: finalRenderState.cuts?.length ?? 0,
        padding: finalRenderState.padding ?? 0,
        durationSec: meta ? Math.round(meta.duration) : undefined,
      });
      const path = await runExport({
        inputPath: documentPath || data.filePath,
        format: store.exportFormat,
        quality: store.exportQuality,
        renderState: finalRenderState,
        exportId,
        gifSettings:
          store.exportFormat === "gif" ? store.gifSettings : undefined,
        speed: store.exportSpeed,
        // GIF carries its own fps in gifSettings; MP4/WebM use the picker
        // (null = keep source rate).
        fps: store.exportFormat === "gif" ? undefined : store.exportFps,
        onState: handleExportState,
      });
      // Safety net: if the export-state success event was missed, fall back to
      // the Promise result. Don't overwrite if the listener already set it.
      if (!exportResult) {
        setExportResult({ kind: "success", path });
      }
      log.info("export", "export_completed", {
        exportId,
        elapsedMs: Date.now() - exportStartedAt,
      });
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      if (!exportResult) {
        if (message.toLowerCase().includes("cancel")) {
          setExportResult({ kind: "cancelled" });
          log.info("export", "export_cancelled", { exportId });
        } else {
          console.error("Export failed:", err);
          log.error("export", "export_failed", { exportId, message });
          setExportResult({ kind: "error", message });
        }
      }
    } finally {
      if (activeExportId === exportId) {
        activeExportId = null;
      }
      store.isExporting = false;
      store.exportProgress = null;
      exportHasProgress = false;
      exportCancelling = false;
      exportFinalizing = false;
    }
  }

  async function handleCancelExport() {
    if (!store.isExporting || exportCancelling || !activeExportId) return;
    exportCancelling = true;
    try {
      await cancelExport(activeExportId);
    } catch (err) {
      toast.error(`Could not cancel: ${err}`);
      exportCancelling = false;
    }
  }

  function dismissExportResult() {
    exportResult = null;
  }

  // Options phase is purely UI — true while the user is in the format/quality
  // picker, before they hit Export. Progress/result phases are derived from
  // the export pipeline state above, so the flow dialog stays a single
  // controlled surface that morphs as the pipeline advances.
  let exportOptionsOpen = $state(false);
  const exportPhase: ExportFlowPhase | null = $derived(
    store.isExporting
      ? "progress"
      : exportResult?.kind === "success"
        ? "success"
        : exportResult?.kind === "cancelled"
          ? "cancelled"
          : exportResult?.kind === "error"
            ? "error"
            : exportOptionsOpen
              ? "options"
              : null,
  );
  const isExportFlowOpen = $derived(exportPhase !== null);

  // Silence-detection cuts only. Manual ripple deletes (`source: "manual"`) are
  // a shipped feature — always honoured in preview and export regardless of the
  // experimental flag — so they must NOT trip the "enable Silence detection"
  // banner. Only auto-detected silence cuts depend on that flag's lane/UI.
  const silenceCutCount = $derived(
    store.cuts.filter((c) => c.source === "silence").length,
  );
  // Manual split/cut edits are gated behind the `timelineEditing` experiment.
  // If a saved project carries them but the flag is off, the cuts are skipped —
  // surface an opt-in so the work isn't silently lost (parallel to silence).
  const manualCutCount = $derived(
    store.cuts.filter((c) => c.source === "manual").length,
  );

  function openExportOptions() {
    if (store.isExporting) return;
    exportOptionsOpen = true;
  }

  function dismissExportOptions() {
    exportOptionsOpen = false;
  }

  function confirmExportOptions() {
    exportOptionsOpen = false;
    void handleExport();
  }

  // Esc routes per phase: cancel a running export, dismiss a finished one,
  // close the options picker. Backdrop click follows the same logic except
  // it never cancels a running export (too easy to misclick mid-encode).
  function handleExportEscape() {
    if (store.isExporting) {
      void handleCancelExport();
      return;
    }
    if (exportResult) {
      dismissExportResult();
      return;
    }
    if (exportOptionsOpen) {
      dismissExportOptions();
    }
  }

  function handleExportBackdrop() {
    if (store.isExporting) return;
    if (exportResult) {
      dismissExportResult();
      return;
    }
    if (exportOptionsOpen) dismissExportOptions();
  }

  async function revealExportInFolder() {
    if (exportResult?.kind !== "success") return;
    try {
      await openFileLocation(exportResult.path);
    } catch (err) {
      toast.error(`Could not open folder: ${err}`);
    }
  }

  /**
   * Push the most recent export to Google Drive. If Drive isn't connected
   * yet we send the user to Settings instead — connecting opens a browser
   * tab and can't sensibly happen from this modal-style success card.
   */
  async function uploadExportToDrive() {
    if (exportResult?.kind !== "success") return;
    await gdrive.init();
    if (!gdrive.connected) {
      toast.info("Connect Google Drive in Settings first.");
      void goto("/settings");
      return;
    }
    try {
      await gdrive.upload(exportResult.path);
      // Progress + completion surface inline via successUpload (below) AND
      // through the corner-notifications store, so the user can still track
      // the upload if they dismiss the success card.
    } catch (e) {
      toast.error(`Drive upload failed: ${e}`);
    }
  }

  /**
   * Share the just-exported file to Recast Cloud and copy the public link.
   * Progress surfaces through the corner-notifications stack (the cloud
   * upload is phase-based, not byte-based, so it isn't mirrored inline like
   * the Drive card). Routes to Settings if not signed in.
   */
  async function shareCurrentExportToCloud() {
    if (exportResult?.kind !== "success") return;
    await cloudShare.init();
    if (!cloudShare.signedIn) {
      toast.info("Sign in to Recast Cloud in Settings first.");
      void goto("/settings");
      return;
    }
    const title =
      exportResult.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Recast";
    try {
      const result = await cloudShare.share(exportResult.path, title);
      try {
        await navigator.clipboard.writeText(result.shareUrl);
        toast.success("Shared — link copied to clipboard.");
      } catch {
        toast.success("Shared to Recast Cloud.");
      }
    } catch (e) {
      toast.error(`Cloud share failed: ${(e as Error)?.message ?? e}`);
    }
  }

  // Mirror the export-success card's path so the upload state below can key
  // off it reactively. Null whenever the dialog isn't in the success state.
  const successPath = $derived(
    exportResult?.kind === "success" ? exportResult.path : null,
  );
  // Most-recent upload (any status) targeting the freshly-exported file —
  // drives the inline progress/result rendering inside the success card.
  // Survives status transitions so we can show the completed state too.
  const successUpload = $derived.by(() => {
    if (!successPath) return undefined;
    const list = gdrive.activeUploads.filter(
      (u) => u.sourcePath === successPath,
    );
    list.sort((a, b) => b.uploadId.localeCompare(a.uploadId));
    return list[0];
  });
  const successUploadPct = $derived(
    successUpload && successUpload.totalBytes
      ? Math.min(
          100,
          Math.round(
            (successUpload.bytesSent / successUpload.totalBytes) * 100,
          ),
        )
      : 0,
  );

  async function copyDriveLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Drive link copied.");
    } catch (e) {
      toast.error(`Could not copy link: ${e}`);
    }
  }

  // `navigator.share` exposure is static — sample once at module load so the
  // Share button can be conditionally rendered without a reactive read.
  const shareSupported = isShareSupported();

  async function shareExportedFile() {
    if (exportResult?.kind !== "success") return;
    const fileName = exportResult.path.split(/[\\/]/).pop() ?? "recording";
    const fallbackLink =
      successUpload?.status === "complete" ? successUpload.webViewLink : undefined;
    const result = await shareRecording({
      path: exportResult.path,
      fileName,
      title: fileName,
      text: "Made with Recast",
      fallbackLink,
    });
    if (result.ok || result.reason === "cancelled") return;
    if (result.reason === "unsupported") {
      toast.error(
        fallbackLink
          ? "Sharing isn't available on this device."
          : "Sharing files isn't available here. Upload to Drive first to share a link.",
      );
    } else {
      toast.error(`Share failed: ${result.message ?? "unknown error"}`);
    }
  }

  async function openDriveLink(link: string) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(link);
    } catch {
      window.open(link, "_blank", "noopener");
    }
  }

  function formatElapsed(ms: number) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00.00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
  }

  function getExportDuration() {
    const duration = store.metadata?.duration ?? 0;
    const clipEnd = store.trimEnd > 0 ? store.trimEnd : duration;
    return Math.max(0, clipEnd - store.trimStart);
  }

  function getExportRangeLabel() {
    const duration = store.metadata?.duration ?? 0;
    const clipEnd = store.trimEnd > 0 ? store.trimEnd : duration;
    return `${formatTime(store.trimStart)} - ${formatTime(clipEnd)}`;
  }


  let isSaving = $state(false);

  async function handleSave() {
    if (!documentPath || isSaving || isLoading) return;
    isSaving = true;
    try {
      const editsJson = JSON.stringify(store.toRenderState());
      const savedAt = await saveProjectEdits(documentPath, editsJson);
      store.markSaved(savedAt);
      toast.success("Saved");
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(`Couldn't save: ${message}`);
    } finally {
      isSaving = false;
    }
  }

  // Wire the editor's mod-combo shortcuts to the central registry. They stay
  // bound for exactly as long as this route is mounted, and are inert on every
  // other route (no handler registered there). Each bails while the export flow
  // dialog owns the screen.
  onMount(() =>
    registerShortcutHandlers({
      "editor.undo": () => {
        if (!isExportFlowOpen) store.undo();
      },
      "editor.redo": () => {
        if (!isExportFlowOpen) store.redo();
      },
      "editor.save": () => {
        if (!isExportFlowOpen) void handleSave();
      },
      "editor.toggleSidebar": () => {
        if (!isExportFlowOpen) showSidebar = !showSidebar;
      },
      "editor.toggleTimeline": () => {
        if (!isExportFlowOpen) showTimeline = !showTimeline;
      },
    }),
  );

  function handleKeydown(e: KeyboardEvent) {
    // `repeat` fires this on auto-repeat while a key is held — a held
    // Ctrl+B would otherwise flip the panel on every tick. Bail so each
    // physical press counts once.
    if (e.defaultPrevented || e.repeat) return;

    // The flow dialog now owns Esc routing per phase; just bail if it's
    // active so the global shortcuts below don't fire under it.
    if (isExportFlowOpen) return;

    // Never hijack typing. Inputs, textareas, and contenteditable surfaces
    // (text annotations) all own their own keystrokes.
    const target = e.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    // Mod-combo editor shortcuts (undo/redo/save, toggle panels, presets) are
    // owned by the central shortcut registry — see `registerShortcutHandlers`
    // below and `$lib/shortcuts`. Dispatched once from the root layout, so they
    // can't double-fire. Bail here on any held Ctrl/⌘ so a modifier combo never
    // trips a plain-key action below.
    if (e.ctrlKey || e.metaKey) return;

    // Plain keys (no Ctrl/⌘): play/pause, frame step, fullscreen.
    switch (e.key) {
      case " ":
        e.preventDefault();
        if (!videoEl) return;
        if (store.isPlaying) {
          videoEl.pause();
          store.isPlaying = false;
        } else {
          videoEl.play();
          store.isPlaying = true;
        }
        break;
      case "ArrowLeft":
        if (videoEl && store.metadata) {
          const frameDur = 1 / (store.metadata.fps || 30);
          videoEl.currentTime = Math.max(0, videoEl.currentTime - frameDur);
          store.currentTime = videoEl.currentTime;
        }
        break;
      case "ArrowRight":
        if (videoEl && store.metadata) {
          const frameDur = 1 / (store.metadata.fps || 30);
          videoEl.currentTime = Math.min(
            store.metadata.duration,
            videoEl.currentTime + frameDur,
          );
          store.currentTime = videoEl.currentTime;
        }
        break;
      case "f":
      case "F":
        e.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else if (previewContainerEl) {
          void previewContainerEl.requestFullscreen();
        }
        break;
    }
  }

  $effect(() => {
    if (!data.filePath || data.filePath === loadedPath) return;
    loadedPath = data.filePath;
    void loadDocument();
  });

  $effect(() => {
    if (!videoEl) return;
    videoEl.muted = true;
  });

  // Back-fill the waveform if the experimental flag flips on after the
  // document loaded with it off. The decode is one-shot per recording, so
  // only fire when we actually have audio paths and no peaks yet.
  $effect(() => {
    if (!experimentalStore.silenceDetection) return;
    if (store.waveform.length > 0) return;
    if (!store.audioPath && !store.microphonePath) return;
    void loadWaveform();
  });

  $effect(() => {
    if (!store.isExporting) return;
    exportNow = Date.now();
    // Elapsed-time timer for the export status strip. The Rust side is now
    // the source of truth for when the UI flips to "finalizing" — it emits
    // an explicit event on ffmpeg's `progress=end`, typically within ~100ms.
    // No more client-side speculative flips on progress stalls.
    const timer = setInterval(() => {
      exportNow = Date.now();
    }, 500);
    return () => clearInterval(timer);
  });

  // Cycle the encode status messages while an export is running.
  $effect(() => {
    if (!store.isExporting) {
      encodeMessageIndex = 0;
      return;
    }
    const timer = setInterval(() => {
      encodeMessageIndex = (encodeMessageIndex + 1) % ENCODE_MESSAGES.length;
    }, 2600);
    return () => clearInterval(timer);
  });

  const stages = $derived([
    {
      key: "text" as const,
      label: "Render text overlays",
      state: prepText,
      skip: prepText === "done" && !renderStateHasText(),
    },
    {
      key: "cursor" as const,
      label: "Render cursor sprites",
      state: prepCursor,
      skip: prepCursor === "done" && store.cursorSettings.style === "dot",
    },
    {
      key: "ship" as const,
      label: "Hand off to encoder",
      state: prepSending,
    },
    {
      key: "encode" as const,
      label: exportFinalizing ? "Finalise file" : "Encode frames",
      state:
        prepSending !== "done"
          ? "pending"
          : exportFinalizing
            ? "running"
            : exportHasProgress
              ? "running"
              : "pending",
    },
  ]);
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 flex min-h-screen w-full flex-col overflow-hidden bg-background text-foreground"
>
  <!-- Dense custom titlebar that embeds the whole editor toolbar in a single row -->
  <CustomTitlebar wrapperClass="h-9">
    <EditorToolbar
      {store}
      filename={data.filename}
      onexport={openExportOptions}
      onsave={handleSave}
      {isSaving}
      {showSidebar}
      {showTimeline}
      onToggleSidebar={() => (showSidebar = !showSidebar)}
      onToggleTimeline={() => (showTimeline = !showTimeline)}
    />
  </CustomTitlebar>

  <!-- Cuts-detected banner: project has accepted silence/manual cuts but the
       experimental flag is off, so the cut lane is hidden and the cuts will
       be silently ignored on export. Surface that loudly with an inline
       opt-in so users sharing projects across machines don't lose work. -->
  {#if !isLoading && !error && silenceCutCount > 0 && !experimentalStore.silenceDetection}
    <div
      class="flex items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning"
      role="status"
    >
      <FlaskConical class="size-3.5 shrink-0" />
      <VolumeX class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">
        This project has {silenceCutCount} silence cut{silenceCutCount === 1
          ? ""
          : "s"} — currently hidden and skipped on export. Enable
        <span class="font-semibold">Silence detection</span> to use them.
      </span>
      <Button
        variant="outline"
        size="xs"
        class="h-6 shrink-0 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
        onclick={() =>
          experimentalStore.setEnabled("silenceDetection", true)}
      >
        Enable
      </Button>
    </div>
  {/if}

  <!-- Manual edits banner: the project has split/cut edits but the opt-in
       timeline-editing feature is off, so they're hidden and skipped on export.
       Surface an inline opt-in so the edits aren't silently dropped. -->
  {#if !isLoading && !error && manualCutCount > 0 && !experimentalStore.timelineEditing}
    <div
      class="flex items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning"
      role="status"
    >
      <FlaskConical class="size-3.5 shrink-0" />
      <Scissors class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">
        This project has {manualCutCount} timeline edit{manualCutCount === 1
          ? ""
          : "s"} — currently hidden and skipped on export. Enable
        <span class="font-semibold">Timeline editing</span> to use them.
      </span>
      <Button
        variant="outline"
        size="xs"
        class="h-6 shrink-0 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
        onclick={() => experimentalStore.setEnabled("timelineEditing", true)}
      >
        Enable
      </Button>
    </div>
  {/if}

  {#if isLoading}
    <EditorSkeleton />
  {:else if error}
    <div class="flex flex-1 items-center justify-center">
      <div
        class="animate-in fade-in flex max-w-sm flex-col items-center gap-3 text-center duration-500"
      >
        <div
          class="flex size-10 items-center justify-center rounded-md border border-destructive/20 bg-destructive/10 text-destructive"
        >
          <span class="text-[18px] font-semibold">!</span>
        </div>
        <p class="text-[12px] text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          size="sm"
          href="/recasts"
          class="gap-1.5"
        >
          <ArrowLeft size={13} />
          Back to recordings
        </Button>
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- Left column: preview + playback + timeline -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          bind:this={previewContainerEl}
          class="flex min-h-0 flex-1 flex-col items-center justify-center bg-background px-2 pt-1.5 pb-1"
        >
          <div
            class="flex-1 flex min-h-0 w-full items-center justify-center relative"
          >
            <VideoPreview
              {store}
              bind:videoEl
              bind:captureFrame
              bind:webcodecsActive
              {videoSrc}
              {cursorPath}
              {cameraSrc}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onReady={handleVideoReady}
              onError={handleVideoError}
              onSeeked={handleVideoSeeked}
            />
          </div>
          <VideoPlayerControls
            {store}
            {videoEl}
            {captureFrame}
            bind:loopEnabled
            fullscreenTargetEl={previewContainerEl}
          />
        </div>

        <!-- Timeline collapses vertically. `slide` (axis:y) animates the
             wrapper height to 0 while the inner keeps its natural height,
             so the preview smoothly reclaims the space instead of snapping. -->
        {#if showTimeline}
          <div
            class="shrink-0 overflow-hidden"
            transition:slide={{ axis: "y", duration: 240, easing: cubicOut }}
          >
            <Timeline {store} {videoEl} />
          </div>
        {/if}
      </div>

      <!-- Right column: properties panel. Collapses horizontally — the inner
           div holds the fixed width so `slide` (axis:x) clips it cleanly to
           0 rather than reflowing the panel's container queries mid-animation. -->
      {#if showSidebar}
        <aside
          class="min-h-0 shrink-0 overflow-hidden border-l border-border/60"
          transition:slide={{ axis: "x", duration: 240, easing: cubicOut }}
        >
          <div class="h-full w-80 xl:w-88">
            <PropertiesPanel {store} {cameraPath} />
          </div>
        </aside>
      {/if}
    </div>
  {/if}

  <!-- Separate audio tracks — .recast projects store system audio and mic audio
       as separate WAVs (the recording.mp4 video stream has no audio). These
       elements are kept in lockstep with the video via $effects above. -->
  {#if systemAudioSrc}
    <!-- svelte-ignore a11y_media_has_caption -->
    <audio
      bind:this={systemAudioEl}
      src={systemAudioSrc}
      preload="auto"
      class="hidden"
    ></audio>
  {/if}
  {#if micAudioSrc}
    <!-- svelte-ignore a11y_media_has_caption -->
    <audio
      bind:this={micAudioEl}
      src={micAudioSrc}
      preload="auto"
      class="hidden"
    ></audio>
  {/if}

  <ExportFlowDialog
    open={isExportFlowOpen}
    phase={exportPhase}
    onEscape={handleExportEscape}
    onBackdropClick={handleExportBackdrop}
    {options}
    {progress}
    {success}
    {cancelled}
    error={errorPanel}
  />
</div>

{#snippet options()}
  <ExportDialog
    {store}
    onConfirm={confirmExportOptions}
    onCancel={dismissExportOptions}
  />
{/snippet}

{#snippet exportSpecStrip()}
  {@const fmt = store.exportFormat}
  {@const isGifFmt = fmt === "gif"}
  {@const srcFps = Math.max(1, Math.round(store.metadata?.fps ?? 60))}
  {@const qualityLabel = isGifFmt
    ? store.gifSettings.quality === "low"
      ? "Lite"
      : store.gifSettings.quality === "high"
        ? "Vivid"
        : "Standard"
    : store.exportQuality === "small"
      ? "720p"
      : store.exportQuality === "hd"
        ? "1080p"
        : store.exportQuality === "4k"
          ? "2160p"
          : "Source"}
  {@const fpsLabel = isGifFmt
    ? store.gifSettings.fps
      ? `${store.gifSettings.fps} fps`
      : "Auto"
    : store.exportFps
      ? `${store.exportFps} fps`
      : `${srcFps} fps`}
  <!-- Spec recap — carries the committed export settings forward from the
       options step so every later phase (encoding, done, cancelled, failed)
       stays anchored to "what you're exporting". Mirrors the options stat
       strip styling for visual continuity. -->
  <section
    class="flex items-stretch divide-x divide-border/40 border-b border-border/40 bg-muted/15 px-5 py-2.5"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 pr-4">
      <span
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
        >Format</span
      >
      <span class="truncate text-[12px] font-medium tabular-nums text-foreground">
        {fmt.toUpperCase()}
      </span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 px-4">
      <span
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
        >{isGifFmt ? "Colors" : "Quality"}</span
      >
      <span class="truncate text-[12px] font-medium tabular-nums text-foreground">
        {qualityLabel}
      </span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 px-4">
      <span
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
        >Frame rate</span
      >
      <span class="truncate text-[12px] font-medium tabular-nums text-foreground">
        {fpsLabel}
      </span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5 pl-4">
      <span
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
        >Duration</span
      >
      <span class="truncate font-mono text-[12px] tabular-nums text-foreground">
        {formatTime(getExportDuration())}
      </span>
    </div>
  </section>
{/snippet}

{#snippet progress()}
  {@const isPreparing =
    prepSending !== "done" && !exportHasProgress && !exportFinalizing}
  {@const eta = exportEtaMs()}
  {@const ringPct = isPreparing
    ? 0
    : exportFinalizing
      ? 100
      : Math.min(100, Math.max(0, displayPct))}
  {@const RING_R = 52}

  <div class="flex flex-col" style="width: 540px;">
    <!-- Header: phase title + reassuring status line. The encode spec moves to
         the shared spec strip below so it reads as a continuation of the
         options step. -->
    <header
      class="flex items-start gap-3 border-b border-border/40 px-5 py-4"
    >
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-(--shadow-craft-inset)"
      >
        <Upload class="size-4" />
      </div>
      <div class="min-w-0 flex-1 pt-0.5">
        <h3
          id="export-flow-title"
          class="text-[14px] font-semibold tracking-tight text-foreground"
        >
          {#if exportCancelling}
            Cancelling export…
          {:else if exportFinalizing}
            Finalising file
          {:else if isPreparing}
            Preparing export
          {:else}
            Encoding video
          {/if}
        </h3>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          {#if exportCancelling}
            Stopping and cleaning up the partial file…
          {:else if exportFinalizing}
            Writing the finished file to disk…
          {:else if isPreparing}
            Getting frames and effects ready…
          {:else}
            This can take a moment — you can keep working.
          {/if}
        </p>
      </div>
    </header>

    {@render exportSpecStrip()}

    <!-- Circular progress ring + stages, centred so the wider spec strip and
         footer frame it consistently with the other phases. -->
    <div
      class="mx-auto flex w-full max-w-xs flex-col items-center gap-3 px-5 pt-5 pb-3"
    >
      <div class="relative size-32" aria-live="polite">
        <svg
          viewBox="0 0 120 120"
          class="size-full -rotate-90 overflow-visible"
        >
          <!-- Track -->
          <circle
            cx="60"
            cy="60"
            r={RING_R}
            stroke="currentColor"
            stroke-width="6"
            class="fill-none text-muted"
          />
          {#if isPreparing}
                  <!-- Indeterminate spinner: a 25-unit arc revolving on a
                       100-unit path. `pathLength="100"` decouples the
                       dash math from `2πr` so floating-point precision
                       can't make the ring sit one pixel short of full. -->
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    pathLength="100"
                    stroke="currentColor"
                    stroke-width="6"
                    stroke-linecap="round"
                    class="fill-none text-primary origin-center animate-spin"
                    style="stroke-dasharray: 25 100; animation-duration: 1.2s;"
                  />
                {:else}
                  <!-- Determinate progress with cubic-bezier-eased fill.
                       Dash values live in inline style so they participate
                       in the CSS transition; mixing attribute + style for
                       the same property breaks animation in some engines. -->
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    pathLength="100"
                    stroke="currentColor"
                    stroke-width="6"
                    stroke-linecap="round"
                    class="fill-none text-primary"
                    style="stroke-dasharray: 100; stroke-dashoffset: {100 - ringPct}; transition: stroke-dashoffset 220ms cubic-bezier(0.65, 0, 0.35, 1);"
                  />
                  {#if exportFinalizing}
                    <!-- Pulsing tip while we wait on FFmpeg's mux/move. -->
                    <circle
                      cx="60"
                      cy={60 - RING_R}
                      r="3.5"
                      class="fill-primary animate-pulse"
                    />
                  {/if}
                {/if}
              </svg>
              <!-- Centre readout: percentage during encoding, dashes
                   while preparing or finalising. -->
              <div
                class="absolute inset-0 flex flex-col items-center justify-center"
              >
                {#if isPreparing}
                  <span
                    class="text-[11px] uppercase tracking-wider text-muted-foreground"
                    >Prep</span
                  >
                  <span class="text-[10px] text-muted-foreground">…</span>
                {:else if exportFinalizing}
                  <span
                    class="font-mono text-2xl font-semibold tabular-nums text-foreground"
                    >99%</span
                  >
                  <span
                    class="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >Finalising</span
                  >
                {:else}
                  <span
                    class="font-mono text-2xl font-semibold tabular-nums text-foreground"
                  >
                    {Math.floor(ringPct)}<span
                      class="text-base text-muted-foreground">%</span
                    >
                  </span>
                  {#if eta !== null}
                    <span
                      class="text-[10px] uppercase tracking-wider text-muted-foreground"
                      >~{formatElapsed(eta)} left</span
                    >
                  {:else if exportStartedAt}
                    <span
                      class="text-[10px] uppercase tracking-wider text-muted-foreground"
                      >{formatElapsed(exportNow - exportStartedAt)} elapsed</span
                    >
                  {/if}
                {/if}
              </div>
            </div>

            <!-- Rotating, encode-themed status line — shimmer sweep + fade
                 between messages so the wait feels alive. Shown only while
                 frames are actually encoding. -->
            {#if !isPreparing && !exportFinalizing && !exportCancelling}
              <div class="relative h-4 self-stretch" aria-live="polite">
                {#key encodeMessageIndex}
                  <span
                    in:fade={{ duration: 320 }}
                    out:fade={{ duration: 320 }}
                    class="export-shimmer absolute inset-0 flex items-center justify-center text-[11px] font-medium tracking-tight"
                  >
                    {ENCODE_MESSAGES[encodeMessageIndex]}…
                  </span>
                {/key}
              </div>
            {/if}

            <!-- Stage list — checkmarks for completed substages, a dot
                 with a subtle pulse for the running one. Collapses to a
                 single "Encoding…" line once Rust takes over. -->
            <ul class="flex flex-col gap-1 self-stretch text-[11px]">
              {#each stages as s}
                {#if !s.skip}
                  <li class="flex items-center gap-2">
                    {#if s.state === "done"}
                      <CheckCircle2 size={11} class="shrink-0 text-success" />
                      <span
                        class="text-muted-foreground line-through decoration-muted-foreground/40"
                        >{s.label}</span
                      >
                    {:else if s.state === "running" && s.key === "ship"}
                      <!-- Beam animation: dots travel through a pipe to suggest
                           the render state being piped to the encoder. -->
                      <span
                        class="ship-beam relative flex h-2.5 w-3.5 shrink-0 items-center overflow-hidden rounded-full bg-primary/15"
                      >
                        <span class="ship-dot ship-dot-1"></span>
                        <span class="ship-dot ship-dot-2"></span>
                        <span class="ship-dot ship-dot-3"></span>
                      </span>
                      <span class="text-foreground">{s.label}</span>
                      <span
                        class="ml-auto font-mono text-[9px] tabular-nums text-muted-foreground"
                        >shipping…</span
                      >
                    {:else if s.state === "running"}
                      <LoaderCircle
                        size={11}
                        class="shrink-0 animate-spin text-primary"
                      />
                      <span class="text-foreground">{s.label}</span>
                    {:else}
                      <Circle
                        size={11}
                        class="shrink-0 text-muted-foreground/40"
                      />
                      <span class="text-muted-foreground/60">{s.label}</span>
                    {/if}
                  </li>
                {/if}
              {/each}
            </ul>
          </div>

    <!-- Footer: Cancel with shortcut Kbd per DESIGN -->
    <footer
      class="flex items-center justify-end gap-2 border-t border-border/40 bg-muted/30 px-3 py-2.5"
    >
      <Button
        variant="destructive_soft"
        size="xs"
        class="gap-1.5"
        onclick={handleCancelExport}
        disabled={exportCancelling}
      >
        <X class="size-3" />
        {exportCancelling ? "Cancelling…" : "Cancel export"}
      </Button>
    </footer>
  </div>
{/snippet}

{#snippet success()}
  <div class="flex flex-col" style="width: 540px;">
    <!-- Header: success badge + title + file path as the secondary line. The
         encode spec is recapped in the shared strip below; the path is the
         thing the user actually needs here, so it stays in the subtitle. -->
    <header class="flex items-start gap-3 border-b border-border/40 px-5 py-4">
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-success/30 bg-success/10 text-success shadow-(--shadow-craft-inset)"
      >
        <CheckCircle2 class="size-4" />
      </div>
      <div class="min-w-0 flex-1 pt-0.5">
        <h3
          id="export-flow-title"
          class="text-[14px] font-semibold tracking-tight text-foreground"
        >
          Export complete
        </h3>
        {#if exportResult?.kind === "success"}
          <p
            class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
            title={exportResult.path}
          >
            {exportResult.path}
          </p>
        {/if}
      </div>
    </header>

    {@render exportSpecStrip()}

    {#if successUpload}
      <!-- Drive row: single horizontal row with leading status icon, label,
           inline progress (when uploading), and trailing inline action
           ("Copy link" when complete, "Cancel" when uploading, "Retry"
           after error/cancel). Sits on a faintly tinted strip so it reads
           as the export's outbound destination, not a generic status card. -->
      <div
        class="flex items-center gap-3 border-t border-border/40 bg-muted/15 px-5 py-3"
        aria-live="polite"
      >
        <div
          class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-card/70 text-muted-foreground shadow-(--shadow-craft-inset)"
        >
          {#if successUpload.status === "uploading"}
            <RefreshCw class="size-3.5 animate-spin text-primary" />
          {:else if successUpload.status === "complete"}
            <HardDriveUpload class="size-3.5 text-success" />
          {:else if successUpload.status === "cancelled"}
            <X class="size-3.5" />
          {:else}
            <TriangleAlert class="size-3.5 text-destructive" />
          {/if}
        </div>

        <div class="min-w-0 flex-1">
          <p class="text-[12px] font-medium text-foreground">
            {#if successUpload.status === "uploading"}
              Uploading to Drive
            {:else if successUpload.status === "complete"}
              Uploaded to Drive
            {:else if successUpload.status === "cancelled"}
              Upload cancelled
            {:else}
              Upload failed
            {/if}
          </p>
          {#if successUpload.status === "uploading"}
            <div class="mt-1 flex items-center gap-2">
              <div class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-200"
                  style="width: {successUploadPct}%"
                ></div>
              </div>
              <span
                class="font-mono text-[10px] tabular-nums text-muted-foreground"
              >
                {successUploadPct}%
              </span>
            </div>
          {:else if successUpload.status === "error" && successUpload.error}
            <p
              class="truncate text-[10.5px] leading-snug text-muted-foreground"
              title={successUpload.error}
            >
              {successUpload.error}
            </p>
          {/if}
        </div>

        <!-- Inline trailing actions. The Drive row owns its whole
             lifecycle: cancel while uploading, copy-link + open once
             complete, retry on failure — so the footer never has to
             carry a Drive-specific action. -->
        {#if successUpload.status === "uploading"}
          <Button
            variant="ghost"
            size="xs"
            class="gap-1.5 text-muted-foreground"
            onclick={() => gdrive.cancelUpload(successUpload!.uploadId)}
          >
            <X class="size-3" />
            Cancel
          </Button>
        {:else if successUpload.status === "complete" && successUpload.webViewLink}
          <div class="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="xs"
              class="gap-1.5 text-primary hover:text-primary"
              onclick={() => copyDriveLink(successUpload!.webViewLink!)}
            >
              <Link2 class="size-3" />
              Copy link
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              title="Open in Drive"
              onclick={() => openDriveLink(successUpload!.webViewLink!)}
            >
              <ExternalLink class="size-3" />
            </Button>
          </div>
        {:else}
          <Button
            variant="ghost"
            size="xs"
            class="gap-1.5 text-muted-foreground"
            onclick={uploadExportToDrive}
          >
            <RefreshCw class="size-3" />
            Retry
          </Button>
        {/if}
      </div>
    {/if}

    <!-- Destinations strip: the three "send it somewhere" actions, grouped
         out of the footer into share-sheet tiles so they read as a single
         choice ("where does this go?") rather than competing with the
         dialog's Dismiss / Show-in-folder lifecycle actions. The Drive tile
         drops out once an upload exists — the Drive row above owns it from
         then on. Tiles use the list-row glass + hover-lift language. -->
    <div class="border-t border-border/40 bg-muted/15 px-5 py-3.5">
      <p
        class="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
      >
        Share or upload
      </p>
      <div class="flex items-stretch gap-2">
        <button
          type="button"
          onclick={shareCurrentExportToCloud}
          class="group/dest flex flex-1 flex-col items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-3 text-center shadow-(--shadow-craft-inset) backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-craft-sm"
        >
          <span
            class="flex size-8 items-center justify-center rounded-lg border border-border/50 bg-card/70 text-muted-foreground shadow-(--shadow-craft-inset) transition-colors group-hover/dest:text-primary"
          >
            <Cloud class="size-4" />
          </span>
          <span class="text-[11px] font-medium leading-none text-foreground">
            Recast Cloud
          </span>
        </button>

        {#if !successUpload}
          <button
            type="button"
            onclick={uploadExportToDrive}
            class="group/dest flex flex-1 flex-col items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-3 text-center shadow-(--shadow-craft-inset) backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-craft-sm"
          >
            <span
              class="flex size-8 items-center justify-center rounded-lg border border-border/50 bg-card/70 text-muted-foreground shadow-(--shadow-craft-inset) transition-colors group-hover/dest:text-primary"
            >
              <HardDriveUpload class="size-4" />
            </span>
            <span class="text-[11px] font-medium leading-none text-foreground">
              Google Drive
            </span>
          </button>
        {/if}

        {#if shareSupported}
          <button
            type="button"
            onclick={shareExportedFile}
            title="Open the system share sheet"
            class="group/dest flex flex-1 flex-col items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-3 text-center shadow-(--shadow-craft-inset) backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-craft-sm"
          >
            <span
              class="flex size-8 items-center justify-center rounded-lg border border-border/50 bg-card/70 text-muted-foreground shadow-(--shadow-craft-inset) transition-colors group-hover/dest:text-primary"
            >
              <Share2 class="size-4" />
            </span>
            <span class="text-[11px] font-medium leading-none text-foreground">
              System share
            </span>
          </button>
        {/if}
      </div>
    </div>

    <!-- Footer: just the two lifecycle actions, per the dialog rhythm —
         dismiss on the left, the primary "Show in folder" on the right. -->
    <footer
      class="flex items-center justify-between gap-2 border-t border-border/40 bg-muted/30 px-3 py-2.5"
    >
      <Button
        variant="ghost"
        size="xs"
        class="gap-1.5 text-muted-foreground"
        onclick={dismissExportResult}
      >
        Dismiss
        <Kbd class="ml-0.5">Esc</Kbd>
      </Button>

      <Button
        variant="default"
        size="xs"
        class="gap-1.5"
        onclick={revealExportInFolder}
      >
        <FolderOpen class="size-3" />
        Show in folder
      </Button>
    </footer>
  </div>
{/snippet}

{#snippet cancelled()}
  <div class="flex flex-col" style="width: 540px;">
    <header
      class="flex items-start gap-3 border-b border-border/40 px-5 py-4"
    >
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted text-muted-foreground shadow-(--shadow-craft-inset)"
      >
        <X class="size-4" />
      </div>
      <div class="min-w-0 flex-1 pt-0.5">
        <h3
          id="export-flow-title"
          class="text-[14px] font-semibold tracking-tight text-foreground"
        >
          Export cancelled
        </h3>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          Stopped before finishing — no file was written. Your settings are
          kept, so you can pick up right where you left off.
        </p>
      </div>
    </header>

    {@render exportSpecStrip()}

    <footer
      class="flex items-center justify-end gap-1.5 border-t border-border/40 bg-muted/30 px-3 py-2.5"
    >
      <Button variant="ghost" size="xs" onclick={dismissExportResult}
        >Dismiss</Button
      >
      <Button
        variant="default"
        size="xs"
        class="gap-1.5"
        onclick={handleExport}
      >
        <Upload class="size-3" />
        Export again
      </Button>
    </footer>
  </div>
{/snippet}

{#snippet errorPanel()}
  <div class="flex flex-col" style="width: 540px;">
    <header
      class="flex items-start gap-3 border-b border-border/40 px-5 py-4"
    >
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive shadow-(--shadow-craft-inset)"
      >
        <TriangleAlert class="size-4" />
      </div>
      <div class="min-w-0 flex-1 pt-0.5">
        <h3
          id="export-flow-title"
          class="text-[14px] font-semibold tracking-tight text-foreground"
        >
          Export failed
        </h3>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          Something went wrong while encoding. Your settings are kept — try
          again, or adjust them first.
        </p>
      </div>
    </header>

    {@render exportSpecStrip()}

    <!-- Failure detail — the raw FFmpeg/pipeline message, scrollable so a long
         stack never blows out the dialog height. -->
    <div
      class="max-h-40 overflow-y-auto border-b border-border/40 px-5 py-3"
    >
      <p
        class="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
      >
        Details
      </p>
      {#if exportResult?.kind === "error"}
        <pre
          class="whitespace-pre-wrap wrap-break-word font-mono text-[10px] leading-snug text-destructive">{exportResult.message}</pre>
      {/if}
    </div>
    <footer
      class="flex items-center justify-end gap-1.5 border-t border-border/40 bg-muted/30 px-3 py-2.5"
    >
      <Button variant="ghost" size="xs" onclick={dismissExportResult}
        >Dismiss</Button
      >
      <Button
        variant="default"
        size="xs"
        class="gap-1.5"
        onclick={handleExport}
      >
        <Upload class="size-3" />
        Try again
      </Button>
    </footer>
  </div>
{/snippet}

<style>
  /* Hand-off-to-encoder beam: three dots travel left → right with offset
     so it reads as data being piped through. Wrapping container clips,
     dots fade in/out at the track edges. */
  .ship-beam {
    box-shadow: inset 0 0 0 1px hsl(var(--border) / 0.3);
  }
  .ship-dot {
    position: absolute;
    width: 3px;
    height: 3px;
    border-radius: 9999px;
    background: hsl(var(--primary));
    top: 50%;
    transform: translate(-50%, -50%);
    animation: ship-beam-travel 1.1s linear infinite;
  }
  .ship-dot-1 {
    animation-delay: 0s;
  }
  .ship-dot-2 {
    animation-delay: 0.36s;
  }
  .ship-dot-3 {
    animation-delay: 0.72s;
  }
  /* Rotating encode status line: a primary-tinted highlight sweeps across
     muted text for a subtle shimmer. The text itself crossfades via Svelte
     transitions when the message changes. */
  .export-shimmer {
    background: linear-gradient(
      100deg,
      var(--muted-foreground) 0%,
      var(--muted-foreground) 38%,
      var(--primary) 50%,
      var(--muted-foreground) 62%,
      var(--muted-foreground) 100%
    );
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: export-shimmer-sweep 2.4s linear infinite;
  }
  @keyframes export-shimmer-sweep {
    from {
      background-position: 160% 0;
    }
    to {
      background-position: -160% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .export-shimmer {
      animation: none;
      background-position: 50% 0;
    }
  }

  @keyframes ship-beam-travel {
    0% {
      left: 0%;
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    100% {
      left: 100%;
      opacity: 0;
    }
  }
</style>
