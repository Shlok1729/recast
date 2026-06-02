<script lang="ts">
  import { platform } from "@tauri-apps/plugin-os";

  import {
    enumerateCameras,
    type BrowserCamera,
  } from "$lib/camera/browser-devices";

  // Wayland (KWin in particular) can trap focus on undecorated transparent
  // alwaysOnTop windows — drop the flag on Linux. See ipc.ts for context.
  const IS_LINUX = platform() === "linux";
  import {
    getAudioDevices,
    getDisplays,
    getLastSource,
    pauseRecording,
    resumeRecording,
    setLastSource,
    startRecording,
    stopRecording,
    validateCameraSource,
    type AudioDeviceInfo,
    type CameraValidationResult,
    type RecordingOptions,
  } from "$lib/ipc";
  import {
    resolveCamera,
    resolveMic,
    type RecordingProfile,
  } from "$lib/profiles";
  import { profilesStore } from "$lib/stores/profiles.svelte";
  import {
    AppWindow,
    Camera,
    CameraOff,
    ChevronDown,
    Circle,
    Crop,
    GripVertical,
    Pause,
    Play,
    Mic,
    MicOff,
    Monitor,
    SlidersHorizontal as SlidersIcon,
    Square,
    Volume2,
    VolumeOff,
    X,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { ButtonGroup } from "@recast/ui/button-group";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { emit, listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  // The panel window is too small to host its own Sonner Toaster; the
  // main window's layout listens for `ui:toast` events and renders
  // them through its always-mounted Toaster. Native `window.alert` is
  // a last-resort fallback for the rare case where `emit` itself
  // throws (no Tauri runtime, IPC unavailable). Sonner is the primary
  // notification surface across the app — see
  // `+layout.svelte` for the listener side of the bridge.
  type ToastLevel = "error" | "warning" | "info" | "success";
  function notify(level: ToastLevel, message: string, duration?: number) {
    emit("ui:toast", { level, message, duration }).catch((err) => {
      console.error("ui:toast emit failed, falling back to alert", err);
      window.alert(message);
    });
  }

  type TargetSource = {
    type: "monitor" | "window" | "region";
    id: number;
    label: string;
    region?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };

  let selectedSource: TargetSource | null = $state(null);
  let isRecording = $state(false);
  let recordingStartTime: number | null = $state(null);
  let now = $state(Date.now());

  // Countdown-before-recording. `countdownSeconds` is the user's setting
  // (Settings → Recording, or a profile override), mirrored from localStorage.
  // `countdownValue` is the live tick — non-null only while counting down, so
  // it drives the transient "countdown" panel phase between the Record click
  // and the real capture start.
  const COUNTDOWN_KEY = "recast-recording-countdown";
  let countdownSeconds = $state(3);
  let countdownValue = $state<number | null>(null);
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  // Panel window dimensions. Idle shows the full control set (matches the
  // launch size in ipc.ts); while recording we collapse to just
  // Stop+timer / Pause / Close and shrink the window to fit so the rest of
  // the bar isn't an invisible click-catcher over the desktop.
  const PANEL_W_IDLE = 520;
  const PANEL_W_RECORDING = 224;
  const PANEL_H = 72;
  // Monotonic token so a newer width animation cancels any in-flight one.
  let widthAnimToken = 0;

  // Three visual phases. `idle` = full controls; `countdown` = big number +
  // cancel; `recording` = collapsed transport. Derived so the markup can
  // switch on a single value.
  const phase = $derived<"idle" | "countdown" | "recording">(
    isRecording ? "recording" : countdownValue !== null ? "countdown" : "idle",
  );

  // Mirror the recording flag to the system tray so its "Start/Stop
  // Recording" label and any tray-driven UX stays accurate. Best-effort:
  // tray init may have failed (no icon registered) — the command is a
  // no-op in that case.
  $effect(() => {
    void invoke("refresh_tray", { isRecording });
  });

  // Pause state. `pausedAccumMs` banks completed pauses; `pausedSince` marks
  // an in-progress pause — the elapsed timer subtracts both so it freezes.
  let isPaused = $state(false);
  let pausedAccumMs = $state(0);
  let pausedSince: number | null = $state(null);

  // While paused, re-prompt every 5 minutes — the camera keeps recording
  // through a pause, so a forgotten pause quietly wastes disk.
  const PAUSE_PROMPT_INTERVAL_MS = 5 * 60 * 1000;
  let pausePromptOpen = $state(false);
  let lastPausePromptAt: number | null = $state(null);

  // Device toggles
  let systemAudioOn = $state(true);
  let micOn = $state(false);
  let cameraOn = $state(false);

  // Selected devices
  let selectedMicId = $state<string | null>(null);
  let selectedMicName = $state("Default");
  let selectedCameraId = $state<string | null>(null);
  let selectedCameraName = $state("Default");
  let cameraValidation = $state<CameraValidationResult | null>(null);

  // Inline notice surface. The panel window is too narrow for a Sonner toast,
  // so resolution outcomes (fallback / missing device / fresh profile applied)
  // are surfaced via button tooltips and a transient profile-button highlight.
  // micWarning / cameraWarning persist in tooltips until the next apply or
  // manual toggle so the user can hover later to see what got swapped.
  let micWarning = $state<string | null>(null);
  let cameraWarning = $state<string | null>(null);

  // Available device lists, refreshed each time we resolve a profile so the
  // resolver works against current hardware (USB devices come and go).
  let mics = $state<AudioDeviceInfo[]>([]);
  let cameras = $state<BrowserCamera[]>([]);

  // Which profile is currently driving the panel state, if any. Manual toggle
  // overrides don't clear this — the chip is just a "last applied" marker.
  let activeProfileId = $state<string | null>(null);
  // Briefly highlights the profile-switcher button after a successful apply
  // so the user gets a confirmation cue without us popping a toast.
  let profileFlash = $state(false);
  let profileFlashTimer: ReturnType<typeof setTimeout> | null = null;

  const activeProfile = $derived(
    activeProfileId ? profilesStore.findById(activeProfileId) : null,
  );

  async function refreshCameraValidation(deviceId: string | null) {
    if (!deviceId) {
      cameraValidation = null;
      return;
    }

    // Browser MediaDevices ids are 64-char hex hashes; the Rust validator
    // looks them up against DirectShow names and will always miss those.
    // Skip validation in that case — `openCameraStream` itself is the source
    // of truth for whether a browser-id camera will actually open.
    if (/^[a-f0-9]{40,}$/i.test(deviceId)) {
      cameraValidation = {
        id: deviceId,
        name: selectedCameraName,
        status: "ready",
        statusMessage: null,
        probedAtUnixMs: Date.now(),
      };
      return;
    }

    try {
      cameraValidation = await validateCameraSource(deviceId);
    } catch {
      cameraValidation = {
        id: deviceId,
        name: selectedCameraName,
        status: "unknown",
        statusMessage: "Camera validation could not complete.",
        probedAtUnixMs: Date.now(),
      };
    }
  }

  onMount(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.background = "transparent";
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "auto";
    (
      html.style as CSSStyleDeclaration & { scrollbarWidth?: string }
    ).scrollbarWidth = "none";
    body.style.background = "transparent";
    body.style.overflow = "hidden";
    body.style.margin = "0";

    const timer = window.setInterval(() => {
      if (isRecording) now = Date.now();
    }, 1000);

    // Countdown setting, mirrored from localStorage. Re-read on `storage`
    // events so changing it in the Settings window updates the panel live
    // (Tauri webviews share a localStorage origin), without a relaunch.
    readCountdownSetting();
    const onStorage = (e: StorageEvent) => {
      if (e.key === COUNTDOWN_KEY) readCountdownSetting();
    };
    window.addEventListener("storage", onStorage);

    const unlistenSource = listen<TargetSource>("source-selected", (event) => {
      selectedSource = event.payload;
      // Persist for next launch.
      setLastSource({
        kind:
          event.payload.type === "monitor"
            ? "monitor"
            : event.payload.type === "window"
              ? "window"
              : "region",
        id: event.payload.id,
        label: event.payload.label,
        regionX: event.payload.region?.x ?? null,
        regionY: event.payload.region?.y ?? null,
        regionWidth: event.payload.region?.width ?? null,
        regionHeight: event.payload.region?.height ?? null,
      }).catch(() => {});
    });

    // Listen for device selection from picker windows
    const unlistenDevice = listen<{
      type: string;
      id: string | null;
      name: string;
    }>("device-selected", (event) => {
      const { type, id, name } = event.payload;
      if (type === "mic") {
        if (id) {
          micOn = true;
          selectedMicId = id;
          selectedMicName = name;
        } else {
          micOn = false;
        }
      } else if (type === "camera") {
        if (id) {
          cameraOn = true;
          selectedCameraId = id;
          selectedCameraName = name;
          void refreshCameraValidation(id);
          openCameraPreview(id);
        } else {
          cameraOn = false;
          cameraValidation = null;
          closeCameraPreview();
        }
      }
    });

    // Profile picker (separate Tauri window, like device-picker) emits this
    // when the user confirms a selection. We resolve the id against the store
    // and apply through the same path as ⌘1-⌘8 shortcuts.
    const unlistenProfile = listen<{ id: string }>("profile-selected", (event) => {
      const target = profilesStore.findById(event.payload.id);
      if (target) handleProfileSwitch(target);
    });

    // Prefer the last-used source from persisted config; fall back to the
    // primary display if no last source is recorded.
    getLastSource()
      .then((last) => {
        if (last) {
          selectedSource = {
            type:
              last.kind === "window"
                ? "window"
                : last.kind === "region"
                  ? "region"
                  : "monitor",
            id: last.id,
            label: last.label,
            region:
              last.kind === "region" &&
              last.regionWidth != null &&
              last.regionHeight != null
                ? {
                    x: last.regionX ?? 0,
                    y: last.regionY ?? 0,
                    width: last.regionWidth,
                    height: last.regionHeight,
                  }
                : undefined,
          };
          return;
        }
        return getDisplays().then((displays) => {
          if (displays.length > 0 && !selectedSource) {
            const d = displays[0];
            selectedSource = {
              type: "monitor",
              id: d.id,
              label: d.isPrimary ? "Primary Display" : `Display ${d.id}`,
            };
          }
        });
      })
      .catch(() => {});

    profilesStore.hydrate();

    void initDevicesAndProfile();

    window.addEventListener("keydown", handleGlobalShortcut);

    // Intercept the window close while a recording is live so it gets
    // finalized & saved instead of lost.
    const closeReq = getCurrentWindow().onCloseRequested((event) => {
      // Already finalizing (or nothing to finalize) — let the close proceed.
      if (isClosing || !isRecording) return;
      event.preventDefault();
      void finalizeAndClose();
    });

    // Tray "Start/Stop Recording" routes here when the panel is open. The
    // toggleRecording() function already does the right thing for either
    // direction (start with current selection, or stop the in-flight one).
    const unlistenTrayToggle = listen("tray:record-toggle", () => {
      void toggleRecording();
    });

    return () => {
      window.clearInterval(timer);
      if (profileFlashTimer) clearTimeout(profileFlashTimer);
      clearCountdown();
      window.removeEventListener("storage", onStorage);
      unlistenSource.then((fn) => fn());
      unlistenDevice.then((fn) => fn());
      unlistenProfile.then((fn) => fn());
      closeReq.then((fn) => fn());
      unlistenTrayToggle.then((fn) => fn());
      window.removeEventListener("keydown", handleGlobalShortcut);
    };
  });

  /**
   * Load audio + video devices, then apply the user's default profile if the
   * profile system is enabled. When profiles are off, fall back to the legacy
   * behavior (default mic, first non-virtual camera, all toggles off except
   * system audio).
   */
  async function initDevicesAndProfile() {
    const [audioDevices, videoDevices] = await Promise.all([
      getAudioDevices().catch(() => [] as AudioDeviceInfo[]),
      enumerateCameras().catch(() => [] as BrowserCamera[]),
    ]);
    mics = audioDevices;
    cameras = videoDevices;

    // Always seed the "current" mic/camera selection with system defaults,
    // even when applying a profile — that way if the user manually toggles
    // mic/camera on later (without the profile), we have something to use.
    const defaultMic = audioDevices.find((d) => d.isDefault) ?? audioDevices[0];
    if (defaultMic) {
      selectedMicId = defaultMic.id;
      selectedMicName = defaultMic.name;
    }
    const defaultCam =
      videoDevices.find((c) => !c.isVirtual) ?? videoDevices[0];
    if (defaultCam) {
      selectedCameraId = defaultCam.deviceId;
      selectedCameraName = defaultCam.label;
      void refreshCameraValidation(defaultCam.deviceId);
    }

    if (!profilesStore.enabled) return;
    const def = profilesStore.default();
    if (!def) return;
    applyProfile(def);
  }

  /**
   * Apply a profile to the panel state — toggles + device selections —
   * resolving devices against the current hardware list. Fallback / missing
   * outcomes are recorded into `micWarning` / `cameraWarning` so the device
   * button tooltips surface them on hover (Sonner toasts would overflow the
   * 44px-tall panel window).
   */
  function applyProfile(profile: RecordingProfile) {
    systemAudioOn = profile.systemAudio;

    // ---- Microphone
    const micResult = resolveMic(profile, mics);
    if (micResult.kind === "matched") {
      micOn = true;
      selectedMicId = micResult.device.id;
      selectedMicName = micResult.device.name;
      micWarning = null;
    } else if (micResult.kind === "fallback") {
      micOn = true;
      selectedMicId = micResult.device.id;
      selectedMicName = micResult.device.name;
      micWarning = `“${micResult.requestedLabel}” unavailable — using “${micResult.device.name}”`;
    } else if (micResult.kind === "missing") {
      micOn = false;
      micWarning = `“${profile.name}” wants a mic but none is available`;
    } else {
      micOn = false;
      micWarning = null;
    }

    // ---- Camera
    const camResult = resolveCamera(profile, cameras);
    if (camResult.kind === "matched") {
      cameraOn = true;
      selectedCameraId = camResult.device.deviceId;
      selectedCameraName = camResult.device.label;
      cameraWarning = null;
      void refreshCameraValidation(camResult.device.deviceId);
      openCameraPreview(camResult.device.deviceId);
    } else if (camResult.kind === "fallback") {
      cameraOn = true;
      selectedCameraId = camResult.device.deviceId;
      selectedCameraName = camResult.device.label;
      cameraWarning = `“${camResult.requestedLabel}” unavailable — using “${camResult.device.label}”`;
      void refreshCameraValidation(camResult.device.deviceId);
      openCameraPreview(camResult.device.deviceId);
    } else if (camResult.kind === "missing") {
      cameraOn = false;
      cameraValidation = null;
      cameraWarning = `“${profile.name}” wants a camera but none is available`;
      closeCameraPreview();
    } else {
      if (cameraOn) closeCameraPreview();
      cameraOn = false;
      cameraValidation = null;
      cameraWarning = null;
    }

    activeProfileId = profile.id;
  }

  function handleProfileSwitch(profile: RecordingProfile) {
    if (isRecording) return;
    applyProfile(profile);
    // Brief 1.4s highlight on the profile button so the user gets a
    // visual confirmation without a toast.
    if (profileFlashTimer) clearTimeout(profileFlashTimer);
    profileFlash = true;
    profileFlashTimer = setTimeout(() => {
      profileFlash = false;
      profileFlashTimer = null;
    }, 1400);
  }

  function handleGlobalShortcut(e: KeyboardEvent) {
    // Esc aborts an in-progress countdown.
    if (countdownValue !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelCountdown();
      }
      return;
    }
    if (isRecording) return;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.shiftKey || e.altKey) return;
    if (!profilesStore.enabled) return;
    const digit = parseInt(e.key, 10);
    if (Number.isFinite(digit) && digit >= 1 && digit <= 8) {
      const profile = profilesStore.profiles[digit - 1];
      if (profile) {
        e.preventDefault();
        handleProfileSwitch(profile);
      }
    }
  }

  function openSourceSelector() {
    if (isRecording) return;
    WebviewWindow.getByLabel("source-selector").then(async (existing) => {
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow("source-selector", {
        url: "/select",
        title: "Select Source",
        width: 560,
        height: 440,
        center: true,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
      });
    });
  }

  function openProfilePicker() {
    if (isRecording) return;
    WebviewWindow.getByLabel("profile-picker").then(async (existing) => {
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow("profile-picker", {
        url: `/profile-picker?selected=${activeProfileId ?? ""}`,
        title: "Switch profile",
        width: 320,
        height: 380,
        center: true,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
      });
    });
  }

  function openDevicePicker(type: "mic" | "camera") {
    if (isRecording) return;
    const label = `device-picker-${type}`;
    const selected = type === "mic" ? selectedMicId : selectedCameraId;
    WebviewWindow.getByLabel(label).then(async (existing) => {
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow(label, {
        url: `/device-picker?type=${type}&selected=${selected ?? ""}`,
        title: `Select ${type === "mic" ? "Microphone" : "Camera"}`,
        width: 320,
        height: 340,
        center: true,
        decorations: false,
        transparent: true,
        shadow: false,
        resizable: false,
      });
    });
  }

  function openCameraPreview(deviceId: string) {
    WebviewWindow.getByLabel("camera-preview").then(async (existing) => {
      if (existing) {
        await existing.close();
      }
      new WebviewWindow("camera-preview", {
        url: `/camera-preview?deviceId=${encodeURIComponent(deviceId)}`,
        title: "Camera",
        width: 200,
        height: 200,
        decorations: false,
        transparent: true,
        shadow: false,
        alwaysOnTop: !IS_LINUX,
        resizable: true,
        x: 40,
        y: 40,
      });
    });
  }

  function closeCameraPreview() {
    emit("camera-recording-stopped");
    emit("camera-stop");
    WebviewWindow.getByLabel("camera-preview").then(async (existing) => {
      if (existing) await existing.close();
    });
  }

  function closePanel() {
    closeCameraPreview();
    getCurrentWindow().close();
  }

  function toggleMic() {
    if (isRecording) return;
    micWarning = null;
    if (micOn) {
      micOn = false;
    } else {
      openDevicePicker("mic");
    }
  }

  function toggleCamera() {
    if (isRecording) return;
    cameraWarning = null;
    if (cameraOn) {
      cameraOn = false;
      closeCameraPreview();
    } else {
      openDevicePicker("camera");
    }
  }

  function readCountdownSetting() {
    try {
      const raw = localStorage.getItem(COUNTDOWN_KEY);
      const n = raw !== null ? Number.parseInt(raw, 10) : 3;
      countdownSeconds = n === 0 || n === 3 || n === 5 || n === 10 ? n : 3;
    } catch {
      countdownSeconds = 3;
    }
  }

  function clearCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownValue = null;
  }

  function cancelCountdown() {
    clearCountdown();
  }

  /**
   * Start path for the Record button. With a countdown configured, tick it
   * down in the panel first (cancelable via Esc or the Cancel button), then
   * fire the real capture. With countdown off, start immediately.
   */
  function beginRecording() {
    if (!selectedSource || isRecording || countdownValue !== null) return;
    if (countdownSeconds <= 0) {
      void startActualRecording();
      return;
    }
    countdownValue = countdownSeconds;
    countdownInterval = setInterval(() => {
      if (countdownValue === null) return;
      countdownValue -= 1;
      if (countdownValue <= 0) {
        clearCountdown();
        void startActualRecording();
      }
    }, 1000);
  }

  /**
   * Animate the panel window's width to `to` (logical px) with an eased rAF
   * tween. Shrinks from the right (top-left origin fixed) so the collapsed
   * controls — which are left-packed during recording — stay put while the
   * empty space folds away. Honors prefers-reduced-motion by snapping.
   */
  async function animatePanelWidth(to: number) {
    const win = getCurrentWindow();
    const token = ++widthAnimToken;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      await win.setSize(new LogicalSize(to, PANEL_H)).catch(() => {});
      return;
    }

    let from = to;
    try {
      const [size, factor] = await Promise.all([
        win.innerSize(),
        win.scaleFactor(),
      ]);
      from = size.width / factor;
    } catch {
      /* fall back to a snap if we can't read the current size */
    }
    if (token !== widthAnimToken) return;
    if (Math.round(from) === Math.round(to)) return;

    const duration = 300;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (t: number) => {
        if (token !== widthAnimToken) return resolve();
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // cubicOut, matches morph.ts
        const w = Math.round(from + (to - from) * eased);
        win.setSize(new LogicalSize(w, PANEL_H)).catch(() => {});
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function toggleRecording() {
    // While counting down, the Record button isn't shown — but a tray toggle
    // or shortcut could still land here; treat it as "cancel the countdown".
    if (countdownValue !== null) {
      cancelCountdown();
      return;
    }
    if (!isRecording) {
      beginRecording();
      return;
    }
    try {
      await stopRecording();
    } catch (e) {
      // Show the actual error, not a misleading "ffmpeg not installed"
      // suffix. By the time stop runs, start has already succeeded —
      // FFmpeg was available, so a stop failure is something else
      // (encoder thread panic, disk full, codec mismatch in the
      // bundled binary, etc.). Misattributing to FFmpeg sent users
      // chasing missing-binary red herrings on bundles where FFmpeg
      // was actually present.
      notify("error", `Stop failed: ${e}`, 10000);
    } finally {
      // ALWAYS reset client-side state, even on stop failure. The Rust
      // `RecordingManager::stop()` does `guard.take()` as its first
      // operation — once that succeeds, the session is gone from the
      // manager regardless of what later fails. Leaving `isRecording`
      // stuck at `true` traps the user into clicking Stop again, which
      // then errors with "recording is not running" because the session
      // is already gone. Resetting here lets the user start a new
      // recording immediately.
      isRecording = false;
      recordingStartTime = null;
      isPaused = false;
      pausedAccumMs = 0;
      pausedSince = null;
      emit("camera-recording-stopped");
      emit("refresh-recordings");
      // Expand the panel back to its full control set.
      void animatePanelWidth(PANEL_W_IDLE);
    }
  }

  async function startActualRecording() {
    if (!selectedSource) return;
    const options: RecordingOptions = {
      systemAudio: systemAudioOn,
      microphone: micOn,
      microphoneDeviceId: micOn ? selectedMicId : null,
      camera: cameraOn,
      // Rust feeds this directly to FFmpeg dshow as a DirectShow friendly
      // name — pass the label, not the browser deviceId hash.
      cameraDeviceId: cameraOn ? selectedCameraName : null,
    };
    try {
      const result = await startRecording(
        selectedSource.type,
        selectedSource.id,
        options,
        selectedSource.type === "region" && selectedSource.region
          ? selectedSource.region
          : null,
      );
      isRecording = true;
      now = Date.now();
      recordingStartTime = now;
      isPaused = false;
      pausedAccumMs = 0;
      pausedSince = null;
      // Collapse the panel to the compact recording transport.
      void animatePanelWidth(PANEL_W_RECORDING);
      if (cameraOn) {
        emit("camera-recording-started", { startedAtUnixMs: now });
      }
      if (result.warnings.length > 0) {
        notify("warning", result.warnings.join("\n"), 8000);
      }
    } catch (e) {
      notify("error", `Recording failed: ${e}`, 10000);
    }
  }

  async function togglePause() {
    if (!isRecording) return;
    try {
      if (isPaused) {
        await resumeRecording();
        if (pausedSince !== null) pausedAccumMs += Date.now() - pausedSince;
        pausedSince = null;
        isPaused = false;
      } else {
        await pauseRecording();
        pausedSince = Date.now();
        isPaused = true;
      }
    } catch (e) {
      notify("error", `Pause/resume failed: ${e}`, 8000);
    }
  }

  // Pause-timeout nudge: once a pause crosses 5 minutes (and every 5 min
  // after, if dismissed) ask the user to resume. Never auto-stops.
  $effect(() => {
    if (!isPaused || pausedSince === null) {
      lastPausePromptAt = null;
      return;
    }
    if (pausePromptOpen) return;
    const since = lastPausePromptAt ?? pausedSince;
    if (now - since >= PAUSE_PROMPT_INTERVAL_MS) {
      void promptPauseTimeout();
    }
  });

  async function promptPauseTimeout() {
    pausePromptOpen = true;
    try {
      const resume = await ask(
        "This recording has been paused for 5 minutes.\n\n" +
          "Resume now? (Use Stop on the panel to finish and save.)",
        {
          title: "Recast - recording paused",
          kind: "warning",
          okLabel: "Resume",
          cancelLabel: "Not now",
        },
      );
      if (resume && isPaused) {
        await togglePause();
      } else {
        // Stay paused — re-arm so we prompt again in another 5 minutes.
        lastPausePromptAt = Date.now();
      }
    } catch {
      lastPausePromptAt = Date.now();
    } finally {
      pausePromptOpen = false;
    }
  }

  // Closing the panel mid-recording must not lose the take: finalize first
  // (which trims out any paused spans), then re-issue the close. The
  // `isClosing` guard lets that second close pass straight through.
  let isClosing = false;
  async function finalizeAndClose() {
    isClosing = true;
    try {
      if (isRecording) await stopRecording();
    } catch (e) {
      console.error("finalize-on-close failed:", e);
    }
    emit("refresh-recordings");
    closeCameraPreview();
    getCurrentWindow().close();
  }

  // Elapsed excludes paused time so the timer freezes while paused.
  const elapsed = $derived.by(() => {
    if (!isRecording || recordingStartTime === null) return 0;
    const livePause = pausedSince !== null ? now - pausedSince : 0;
    const ms = now - recordingStartTime - pausedAccumMs - livePause;
    return Math.max(0, Math.floor(ms / 1000));
  });
  const timer = $derived(
    `${Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`,
  );
</script>

<!-- Outer wrapper: fills the (oversized) Tauri window. Padding gives the
     inner panel's drop-shadow room to render without being clipped at the
     window edge. The window itself is transparent so this padding shows
     the desktop through. -->
<div
  class="flex h-dvh w-dvw items-center justify-center px-4 py-3"
  data-tauri-drag-region
>
<div
  class="group/panel relative flex h-11 overflow-hidden no-scrollbar w-full items-center gap-1 bg-card/95 p-2 pl-1 backdrop-blur-3xl border border-border/60 rounded-lg ring-1 ring-foreground/5"
  data-tauri-drag-region
>
  <!-- Drag handle: explicit affordance for moving the panel. The whole bar
       is a Tauri drag region, but users don't know that without a visible
       grip. Hover lifts opacity so it doesn't compete visually at rest. -->
  <div
    data-tauri-drag-region
    class="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted/40 hover:text-muted-foreground active:cursor-grabbing"
    title="Drag to move"
    aria-label="Drag panel"
  >
    <GripVertical size={12} strokeWidth={2} class="pointer-events-none" />
  </div>

  {#if phase === "countdown"}
    <!-- Countdown phase: big ticking number + Cancel, in place of the full
         control set. The panel stays full-width here; it only collapses once
         capture actually starts. Esc also cancels (see handleGlobalShortcut). -->
    <div
      class="flex w-full items-center gap-2.5 pr-1"
      data-tauri-drag-region
      in:fade={{ duration: 120 }}
    >
      <div
        class="relative flex size-7 shrink-0 items-center justify-center"
        aria-live="assertive"
      >
        <span class="absolute inset-0 rounded-full ring-2 ring-primary/25"></span>
        <span
          class="font-mono text-[15px] font-bold leading-none tabular-nums text-primary"
        >
          {countdownValue}
        </span>
      </div>
      <span class="text-[12px] font-semibold tracking-tight text-foreground/80">
        Starting in {countdownValue}s…
      </span>
      <Button
        onclick={cancelCountdown}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        size="sm"
        variant="ghost"
        class="ml-auto h-7 gap-1.5"
        title="Cancel (Esc)"
      >
        <X size={12} strokeWidth={2.5} class="text-destructive" />
        <span class="text-[11px] font-semibold">Cancel</span>
      </Button>
    </div>
  {:else}
  <ButtonGroup>
    <!-- Record / Stop -->
    <Button
      onclick={toggleRecording}
      onmousedown={(e: MouseEvent) => e.stopPropagation()}
      size={isRecording ? "sm" : "icon-sm"}
      variant={isRecording ? "destructive" : "default"}
      title={isRecording ? "Stop Recording" : "Start Recording"}
    >
      {#if isRecording}
        <Square
          size={12}
          strokeWidth={0}
          fill="currentColor"
          class="animate-pulse"
        />
      {:else}
        <Circle size={14} strokeWidth={0} fill="currentColor" />
      {/if}
      {#if isRecording}
        <span
          class="shrink-0 font-mono text-[13px] font-semibold tabular-nums tracking-tight"
          class:text-foreground={!isPaused}
          class:text-muted-foreground={isPaused}
          data-tauri-drag-region
        >
          {timer}
        </span>
      {/if}
    </Button>

    <!-- Pause / Resume -->
    {#if isRecording}
      <Button
        onclick={togglePause}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        size="icon-sm"
        variant={isPaused ? "default" : "secondary"}
        title={isPaused ? "Resume Recording" : "Pause Recording"}
      >
        {#if isPaused}
          <Play size={13} strokeWidth={0} fill="currentColor" />
        {:else}
          <Pause size={13} strokeWidth={0} fill="currentColor" />
        {/if}
      </Button>
    {/if}
  </ButtonGroup>

  <!-- Source. Hidden once recording starts — the source is locked in, so the
       selector just takes space; dropping it is part of the collapse. -->
  {#if !isRecording}
  <Button
    size="sm"
    disabled={isRecording}
    onclick={openSourceSelector}
    onmousedown={(e: MouseEvent) => e.stopPropagation()}
    variant="ghost"
    class="group/source hover:scale-none"
    out:fade={{ duration: 120 }}
  >
    {#if selectedSource?.type === "window"}
      <AppWindow
        size={12}
        strokeWidth={2}
        class="shrink-0 text-foreground/30 group-hover/source:text-foreground/50 transition-colors"
      />
    {:else if selectedSource?.type === "region"}
      <Crop
        size={12}
        strokeWidth={2}
        class="shrink-0 text-foreground/30 group-hover/source:text-foreground/50 transition-colors"
      />
    {:else}
      <Monitor
        size={12}
        strokeWidth={2}
        class="shrink-0 text-foreground/30 group-hover/source:text-foreground/50 transition-colors"
      />
    {/if}
    <span
      class="max-w-35 truncate text-[12px] font-semibold tracking-tight text-foreground/60 group-hover/source:text-foreground/90 transition-colors"
    >
      {selectedSource?.label ?? "Select source"}
    </span>
    {#if !isRecording}
      <ChevronDown
        size={10}
        strokeWidth={3}
        class="shrink-0 text-foreground/20 transition-transform group-hover/source:translate-y-0.5"
      />
    {/if}
  </Button>
  {/if}

  <!-- Right cluster. While recording, the profile switcher and device toggles
       are hidden and `ml-auto` is dropped so the remaining Close button packs
       in tight next to the transport — the panel collapses to just the
       essentials. -->
  <div
    class="shrink-0 px-1 inline-flex items-center gap-1"
    class:ml-auto={!isRecording}
  >
    {#if !isRecording}
    <div class="inline-flex items-center gap-1" out:fade={{ duration: 120 }}>
    <!-- Profile switcher button. Opens a separate Tauri window (like the
         device-pickers) instead of a popover — the panel window is too
         short to host an in-place dropdown without changing its height,
         and resizing the panel mid-flow looks wrong. -->
    {#if profilesStore.enabled && profilesStore.profiles.length > 0}
      <Button
        size="icon-sm"
        variant={profileFlash ? "default_soft" : "ghost"}
        disabled={isRecording}
        onclick={openProfilePicker}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        title={activeProfile
          ? `Profile: ${activeProfile.name} — click to switch`
          : "Switch profile"}
        aria-label="Switch profile"
      >
        <SlidersIcon size={13} strokeWidth={2} />
      </Button>
    {/if}

    <!-- Device toggles -->
    <ButtonGroup>
      <!-- System audio -->
      <Button
        size="icon-sm"
        variant={systemAudioOn ? "default_soft" : "outline"}
        disabled={isRecording}
        onclick={() => (systemAudioOn = !systemAudioOn)}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        title={systemAudioOn ? "System audio: on" : "System audio: off"}
      >
        {#if systemAudioOn}
          <Volume2 size={14} strokeWidth={2} />
        {:else}
          <VolumeOff size={14} strokeWidth={2} />
        {/if}
      </Button>

      <!-- Mic. `micWarning` is set by `applyProfile` when a saved mic was
           missing or got swapped — surfaced in the tooltip rather than a
           toast so the panel stays minimal. -->
      <Button
        variant={micOn
          ? micWarning
            ? "destructive_soft"
            : "default_soft"
          : micWarning
            ? "destructive_soft"
            : "outline"}
        size="icon-sm"
        disabled={isRecording}
        onclick={toggleMic}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        title={micOn
          ? `Mic: ${selectedMicName}${micWarning ? ` — ${micWarning}` : ""}`
          : micWarning
            ? `Microphone: off — ${micWarning}`
            : "Microphone: off"}
      >
        {#if micOn}
          <Mic size={14} strokeWidth={2} />
        {:else}
          <MicOff size={14} strokeWidth={2} />
        {/if}
      </Button>

      <!-- Camera. `cameraWarning` (from profile apply) and `cameraValidation`
           (from device probe) both surface in the tooltip; whichever is
           present wins the destructive_soft tint. -->
      <Button
        disabled={isRecording}
        onclick={toggleCamera}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        variant={cameraOn
          ? cameraValidation?.status === "error" || cameraWarning
            ? "destructive_soft"
            : "default_soft"
          : cameraWarning
            ? "destructive_soft"
            : "outline"}
        size="icon-sm"
        title={cameraOn
          ? `Camera: ${selectedCameraName}${cameraValidation?.statusMessage ? ` — ${cameraValidation.statusMessage}` : ""}${cameraWarning ? ` — ${cameraWarning}` : ""}`
          : cameraWarning
            ? `Camera: off — ${cameraWarning}`
            : "Camera: off"}
      >
        {#if cameraOn}
          <Camera size={14} strokeWidth={2} />
        {:else}
          <CameraOff size={14} strokeWidth={2} />
        {/if}
      </Button>
    </ButtonGroup>
    </div>
    {/if}
    <!-- Close -->
    <Button
      onclick={closePanel}
      onmousedown={(e: MouseEvent) => e.stopPropagation()}
      title="Close"
      size="icon-sm"
      variant="ghost"
    >
      <X size={10} strokeWidth={2} class="shrink-0 text-destructive" />
    </Button>
  </div>
  {/if}
</div>
</div>
