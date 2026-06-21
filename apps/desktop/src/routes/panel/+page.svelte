<script lang="ts">
  import { platform } from "@tauri-apps/plugin-os";

  import {
    enumerateCameras,
    type BrowserCamera,
  } from "$lib/camera/browser-devices";
  import { checkCapability, loadCapabilities } from "$lib/capabilities";

  // Wayland (KWin in particular) can trap focus on undecorated transparent
  // alwaysOnTop windows — drop the flag on Linux. See ipc.ts for context.
  const IS_LINUX = platform() === "linux";
  import {
    getAudioDevices,
    getDisplays,
    getLastSource,
    pauseRecording,
    refreshTray,
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
    loadRecordingFps,
    loadRecordingQuality,
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
  import { recordingCountdown } from "$lib/stores/recording-countdown.svelte";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { emit, listen } from "@tauri-apps/api/event";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { fade, scale } from "svelte/transition";

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
    /** Monitor refresh rate in Hz (monitors only); caps the useful capture
     *  fps so we never record above what the display can present. */
    refreshHz?: number;
    region?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };

  let selectedSource: TargetSource | null = $state(null);
  let isRecording = $state(false);
  // True for the brief window between the countdown ending (or being skipped)
  // and the `startRecording` IPC resolving. Without it, `countdownValue` goes
  // null while we await the IPC, so `phase` falls back to "idle" and the bar
  // flashes the full control set — expanding then collapsing — between the
  // countdown and recording phases. Treating "starting" as "recording" keeps
  // the morph a single countdown→recording crossfade.
  let isStarting = $state(false);
  // Stop IPC in-flight. On macOS, `stop_recording` joins the capture/encoder
  // threads and finalizes the muxer, which can take a beat — without this
  // guard a second click fired another `stopRecording()` (the first await
  // hadn't resolved, so `isRecording` was still true), racing the backend's
  // `guard.take()` and surfacing a bogus "recording is not running" error.
  let isStopping = $state(false);
  let recordingStartTime: number | null = $state(null);
  let now = $state(Date.now());

  // Countdown-before-recording. The effective duration (`countdownSeconds`) is
  // derived from the *active profile's* override, falling back to the global
  // `recordingCountdown` store — both reactive and both kept in sync across
  // windows, so editing either on another page is reflected live here. That
  // derived lives next to `activeProfile` below. `countdownValue` is the live
  // integer tick (null unless counting down); `countdownProgress` (1 → 0) drives
  // the depleting ring (already normalised against the chosen duration).
  let countdownValue = $state<number | null>(null);
  let countdownProgress = $state(1);
  let countdownRaf: number | null = null;
  // Circumference of the progress ring (r=16 in the 36×36 viewBox). The visible
  // arc length is `C × progress`, so the dash offset is `C × (1 − progress)`.
  const RING_C = 2 * Math.PI * 16;

  // Panel sizing. The bar's width is driven by a Svelte `Tween` that follows
  // the *measured* natural width of its content (the same morph technique as
  // ExportFlowDialog) — buttery, rAF-driven, and consistent with the rest of
  // the app's motion. The content declares its own size via `w-fit`; the bar
  // just follows.
  //
  // Crucially, the Tauri window is left at its fixed launch size (520×72, sized
  // in ipc.ts to hug the full idle bar with room for the drop shadow) and is
  // NOT resized per phase. A centered, always-on-top window can't be resized
  // and repositioned in a single atomic frame, so snapping it mid-morph made
  // the bar visibly drift sideways. Instead the bar just morphs *centered
  // inside the fixed window* — the transparent margins on either side double as
  // a drag region. This mirrors ExportFlowDialog, which morphs a DOM element
  // within a fixed viewport and never touches the window.
  const BAR_W_IDLE = 488;

  let barContentEl = $state<HTMLElement | null>(null);
  let measuredBarW = $state(BAR_W_IDLE);
  const barWidth = new Tween(BAR_W_IDLE, { duration: 340, easing: cubicOut });
  // Snap the very first measurement instead of animating from the seed value.
  let barFirstMeasure = true;
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Watch the content's natural width and tween the bar to match. Uses the
  // border box (includes the content's own padding) so the bar wraps it
  // exactly, and rounds to whole px so sub-pixel jitter can't retrigger.
  $effect(() => {
    if (!barContentEl) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(
        entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width,
      );
      if (w > 0) measuredBarW = w;
    });
    ro.observe(barContentEl);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (measuredBarW <= 0) return;

    if (barFirstMeasure) {
      // First paint: size the bar to the content with no animation.
      barWidth.set(measuredBarW, { duration: 0 });
      barFirstMeasure = false;
      return;
    }

    // Tween the bar to the new measured width (instant under reduced motion).
    // The window never moves — the bar morphs centered within it.
    if (prefersReducedMotion) barWidth.set(measuredBarW, { duration: 0 });
    else barWidth.target = measuredBarW;
  });

  // Three visual phases. `idle` = full controls; `countdown` = big number +
  // cancel; `recording` = collapsed transport. Derived so the markup can
  // switch on a single value.
  const phase = $derived<"idle" | "countdown" | "recording">(
    isRecording || isStarting
      ? "recording"
      : countdownValue !== null
        ? "countdown"
        : "idle",
  );

  // Mirror the recording flag to the system tray so its "Start/Stop
  // Recording" label and any tray-driven UX stays accurate. Best-effort:
  // tray init may have failed (no icon registered) — the command is a
  // no-op in that case.
  $effect(() => {
    void refreshTray(isRecording);
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

  // Effective countdown duration: the active profile's per-profile override
  // (`0` = off, a number = pinned, `null`/absent = inherit) wins over the global
  // setting. Derived straight off `activeProfile` rather than snapshotted at
  // apply-time, so a live edit to the active profile (synced cross-window via
  // `profilesStore`) updates the countdown immediately — this is what makes the
  // per-profile value actually get respected, not just the global one.
  const countdownSeconds = $derived(
    activeProfile?.countdown ?? recordingCountdown.value,
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
          // Restored a monitor — look up its current refresh rate (best
          // effort, off the start path) so record-time fps clamping knows the
          // display's ceiling without an extra probe at capture time.
          if (selectedSource?.type === "monitor") {
            const restoredId = selectedSource.id;
            getDisplays()
              .then((displays) => {
                const hz = displays.find((d) => d.id === restoredId)?.refreshHz;
                if (hz && selectedSource && selectedSource.id === restoredId) {
                  selectedSource = { ...selectedSource, refreshHz: hz };
                }
              })
              .catch(() => {});
          }
          return;
        }
        return getDisplays().then((displays) => {
          if (displays.length > 0 && !selectedSource) {
            const d = displays[0];
            selectedSource = {
              type: "monitor",
              id: d.id,
              label: d.isPrimary ? "Primary Display" : `Display ${d.id}`,
              refreshHz: d.refreshHz || undefined,
            };
          }
        });
      })
      .catch(() => {});

    profilesStore.hydrate();

    void initDevicesAndProfile();
    // Warm the capability probe so the first mic/camera/system-audio toggle
    // resolves instantly instead of waiting on a cold `capture_capabilities`.
    void loadCapabilities();

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

    // The countdown follows the active profile live via the `countdownSeconds`
    // derived — setting `activeProfileId` is all that's needed; no snapshot.
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
    // During the pre-roll: Esc aborts, Enter/Space skips straight to capture.
    if (countdownValue !== null) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelCountdown();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        startNow();
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

  async function toggleMic() {
    if (isRecording) return;
    micWarning = null;
    if (micOn) {
      micOn = false;
      return;
    }
    const verdict = await checkCapability("microphone", "Microphone");
    if (!verdict.ok) {
      notify("warning", verdict.message);
      return;
    }
    openDevicePicker("mic");
  }

  async function toggleCamera() {
    if (isRecording) return;
    cameraWarning = null;
    if (cameraOn) {
      cameraOn = false;
      closeCameraPreview();
      return;
    }
    const verdict = await checkCapability("camera", "Webcam");
    if (!verdict.ok) {
      notify("warning", verdict.message);
      return;
    }
    openDevicePicker("camera");
  }

  async function toggleSystemAudio() {
    // Turning it off is always fine; only gate turning it on.
    if (systemAudioOn) {
      systemAudioOn = false;
      return;
    }
    const verdict = await checkCapability("systemAudio", "System audio");
    if (!verdict.ok) {
      notify("warning", verdict.message);
      return;
    }
    systemAudioOn = true;
  }

  function clearCountdown() {
    if (countdownRaf !== null) {
      cancelAnimationFrame(countdownRaf);
      countdownRaf = null;
    }
    countdownValue = null;
    countdownProgress = 1;
  }

  function cancelCountdown() {
    clearCountdown();
  }

  /** Skip the remaining pre-roll and start capturing right now. */
  function startNow() {
    if (countdownValue === null) return;
    // Enter "starting" before clearing the countdown so `phase` jumps straight
    // to "recording" rather than dipping through "idle" while the IPC resolves.
    isStarting = true;
    clearCountdown();
    void startActualRecording();
  }

  /**
   * Start path for the Record button. With a countdown configured, run a
   * deadline-based pre-roll in the panel first (cancelable via Esc / Cancel,
   * skippable via the ring / Enter) then fire the real capture. With countdown
   * off, start immediately.
   *
   * The loop is driven by `requestAnimationFrame` against a fixed end time
   * rather than a 1s `setInterval`: the integer readout stays accurate (no
   * drift from timer slop) and the ring depletes smoothly at display refresh
   * rate. rAF also auto-pauses if the panel is hidden.
   */
  function beginRecording() {
    if (!selectedSource || isRecording || isStarting || countdownValue !== null)
      return;
    const secs = countdownSeconds;
    if (secs <= 0) {
      void startActualRecording();
      return;
    }
    const totalMs = secs * 1000;
    const endsAt = Date.now() + totalMs;
    countdownValue = secs;
    countdownProgress = 1;
    const tick = () => {
      const remaining = endsAt - Date.now();
      if (remaining <= 0) {
        // Bridge to "recording" via `isStarting` so the phase never falls back
        // to "idle" during the start IPC (see `isStarting` declaration).
        isStarting = true;
        clearCountdown();
        void startActualRecording();
        return;
      }
      countdownValue = Math.ceil(remaining / 1000);
      countdownProgress = remaining / totalMs;
      countdownRaf = requestAnimationFrame(tick);
    };
    countdownRaf = requestAnimationFrame(tick);
  }

  async function toggleRecording() {
    // While counting down, the Record button isn't shown — but a tray toggle
    // or shortcut could still land here; treat it as "cancel the countdown".
    if (countdownValue !== null) {
      cancelCountdown();
      return;
    }
    // Mid-handoff (countdown ended, start IPC in flight): ignore the toggle so
    // a stray click on the transitioning transport doesn't kick off a fresh
    // countdown before `isRecording` flips.
    if (isStarting) return;
    if (!isRecording) {
      beginRecording();
      return;
    }
    // A stop is already in flight — ignore repeat clicks so we don't fire a
    // second `stopRecording()` that races the first and errors out.
    if (isStopping) return;
    try {
      isStopping = true;
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
      recordingStartTime = null;
      isPaused = false;
      pausedAccumMs = 0;
      pausedSince = null;
      emit("camera-recording-stopped");
      emit("refresh-recordings");
      // Back to "idle" phase — the ResizeObserver → Tween effect expands the
      // bar back out to the full control set (centered in the fixed window).
      isRecording = false;
      isStopping = false;
    }
  }

  /** Cap a desired capture fps to the selected monitor's refresh rate. `null`
   *  (Auto) and non-monitor / unknown-refresh sources pass through unchanged —
   *  the backend still clamps to its 24–240 range. */
  function clampFpsToDisplay(desired: number | null): number | null {
    if (desired == null) return null;
    const cap =
      selectedSource?.type === "monitor" ? selectedSource.refreshHz : undefined;
    return cap && cap >= 1 ? Math.min(desired, cap) : desired;
  }

  async function startActualRecording() {
    if (!selectedSource) {
      isStarting = false;
      return;
    }
    const options: RecordingOptions = {
      systemAudio: systemAudioOn,
      microphone: micOn,
      microphoneDeviceId: micOn ? selectedMicId : null,
      camera: cameraOn,
      // Rust feeds this directly to FFmpeg dshow as a DirectShow friendly
      // name — pass the label, not the browser deviceId hash.
      cameraDeviceId: cameraOn ? selectedCameraName : null,
      // Global capture preferences set in Settings → Recording, read fresh at
      // start time (localStorage is shared across the app's webviews). The
      // backend clamps/validates both, so a stale or missing value is safe.
      // The desired fps is additionally capped to the selected monitor's
      // refresh — capturing above it only duplicates frames, so e.g. a 144 fps
      // preference records at 60 on a 60 Hz display while still recording 144
      // on a 144 Hz one. The user's preference itself is left untouched.
      fps: clampFpsToDisplay(loadRecordingFps()),
      quality: loadRecordingQuality(),
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
      // Flip both in the same synchronous block: `phase` stays "recording"
      // (isStarting → isRecording) with no idle frame in between.
      isRecording = true;
      isStarting = false;
      now = Date.now();
      recordingStartTime = now;
      isPaused = false;
      pausedAccumMs = 0;
      pausedSince = null;
      // Flipping to the "recording" phase swaps in the compact transport; the
      // ResizeObserver → Tween effect collapses the bar (centered in the fixed
      // window) automatically. Nothing to do here.
      if (cameraOn) {
        emit("camera-recording-started", { startedAtUnixMs: now });
      }
      if (result.warnings.length > 0) {
        notify("warning", result.warnings.join("\n"), 8000);
      }
    } catch (e) {
      // Start failed — drop out of "starting" so the bar morphs back to idle
      // instead of being stuck showing the recording transport.
      isStarting = false;
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

  // Out-transition for a leaving phase block: pin it absolute at its current
  // size so it no longer contributes to the content's measured width while it
  // fades. The entering block sits in normal flow, so ResizeObserver reports
  // the *new* width immediately and the bar Tween animates to it concurrent
  // with the crossfade. Mirrors ExportFlowDialog's `phaseOut`.
  function phaseOut(node: HTMLElement) {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    // Pin centered (not top-left) so that as the bar morphs to the smaller
    // incoming phase, the leaving phase clips/fades symmetrically from the
    // center instead of appearing to shift to the left.
    node.style.position = "absolute";
    node.style.left = "50%";
    node.style.top = "50%";
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    node.style.transform = "translate(-50%, -50%)";
    return {
      duration: 220,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t}`,
    };
  }
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
  class="group/panel relative flex h-11 shrink-0 items-center justify-center overflow-hidden no-scrollbar bg-card/95 backdrop-blur-xl border border-border/60 rounded-lg ring-1 ring-foreground/5"
  style="width: {barWidth.current}px"
  data-tauri-drag-region
>
  <!-- Content declares its own natural width (`w-fit`); the bar's width is a
       Tween that follows it via ResizeObserver, so collapse/expand is one
       smooth motion. The bar centers this content, so it morphs symmetrically. -->
  <div
    bind:this={barContentEl}
    class="relative flex w-fit shrink-0 items-center justify-center gap-1 p-2"
    data-tauri-drag-region
  >
  {#if phase === "countdown"}
    <!-- Countdown phase: a depleting progress ring with the ticking second
         inside (click to start now), a two-line status, and Cancel. Crossfades
         with the other phases; the bar Tween follows its natural width. -->
    <div
      class="flex w-fit items-center gap-2.5 pl-1"
      data-tauri-drag-region
      in:fade={{ duration: 200, delay: 80, easing: cubicOut }}
      out:phaseOut
    >
      <!-- Ring + number. The whole disc is a "start now" affordance: clicking
           skips the remaining pre-roll and begins capture immediately. -->
      <button
        type="button"
        onclick={startNow}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        title="Start now"
        aria-label={`Recording starts in ${countdownValue} seconds — click to start now`}
        class="group/cd relative flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <svg
          class="absolute inset-0 size-7 -rotate-90"
          viewBox="0 0 36 36"
          aria-hidden="true"
        >
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            class="text-primary/15"
          />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            class="text-primary"
            stroke-dasharray={RING_C}
            stroke-dashoffset={RING_C * (1 - countdownProgress)}
          />
        </svg>
        <!-- The second pops on each tick; on hover it yields to a play glyph so
             the skip affordance is discoverable. -->
        {#key countdownValue}
          <span
            in:scale={{
              start: prefersReducedMotion ? 1 : 0.5,
              duration: prefersReducedMotion ? 0 : 220,
              easing: cubicOut,
            }}
            class="font-mono text-[12px] font-bold leading-none tabular-nums text-primary transition-opacity group-hover/cd:opacity-0"
          >
            {countdownValue}
          </span>
        {/key}
        <Play
          size={11}
          strokeWidth={0}
          fill="currentColor"
          class="absolute text-primary opacity-0 transition-opacity group-hover/cd:opacity-100"
        />
      </button>

      <span class="flex shrink-0 flex-col leading-tight">
        <span
          class="whitespace-nowrap text-[11px] font-semibold tracking-tight text-foreground"
        >
          Get ready…
        </span>
        <span
          class="whitespace-nowrap text-[10px] font-medium tabular-nums text-muted-foreground"
        >
          Starting in {countdownValue}s
        </span>
      </span>

      <Button
        onclick={cancelCountdown}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        size="icon-sm"
        variant="ghost"
        title="Cancel (Esc)"
        aria-label="Cancel countdown"
      >
        <X size={12} strokeWidth={2.5} class="text-destructive" />
      </Button>
    </div>
  {:else if phase === "recording"}
    <!-- Recording phase: compact transport — soft-red Stop+timer, Pause,
         Close — crossfaded in and centered by the bar. -->
    <div
      class="flex w-fit items-center gap-1"
      in:fade={{ duration: 200, delay: 80, easing: cubicOut }}
      out:phaseOut
    >
      <ButtonGroup>
        <Button
          onclick={toggleRecording}
          onmousedown={(e: MouseEvent) => e.stopPropagation()}
          disabled={isStopping}
          size="sm"
          variant="destructive_soft"
          title="Stop Recording"
        >
          <Square
            size={11}
            strokeWidth={0}
            fill="currentColor"
            class="animate-pulse text-destructive"
          />
          <span
            class="shrink-0 font-mono text-[13px] font-semibold tabular-nums tracking-tight"
            class:text-foreground={!isPaused}
            class:text-muted-foreground={isPaused}
            data-tauri-drag-region
          >
            {timer}
          </span>
        </Button>
        <Button
          onclick={togglePause}
          onmousedown={(e: MouseEvent) => e.stopPropagation()}
          size="icon-sm"
          variant={isPaused ? "success_soft" : "secondary"}
          title={isPaused ? "Resume Recording" : "Pause Recording"}
        >
          {#if isPaused}
            <Play size={13} strokeWidth={0} fill="currentColor" />
          {:else}
            <Pause size={13} strokeWidth={0} fill="currentColor" />
          {/if}
        </Button>
      </ButtonGroup>
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
  {:else}
    <!-- Idle phase: full control set. Crossfades with the others. -->
    <div
      class="flex w-fit items-center gap-1"
      in:fade={{ duration: 200, delay: 80, easing: cubicOut }}
      out:phaseOut
    >
      <!-- Drag handle: explicit affordance for moving the panel. The whole
           bar is a Tauri drag region, but the grip makes that discoverable. -->
      <div
        data-tauri-drag-region
        class="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted/40 hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to move"
        aria-label="Drag panel"
      >
        <GripVertical size={12} strokeWidth={2} class="pointer-events-none" />
      </div>
      <!-- Record. The big primary action; clicking it begins the countdown
           (or starts capture immediately when countdown is off). -->
      <Button
        onclick={toggleRecording}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        size="icon-sm"
        variant="default"
        title="Start Recording"
      >
        <Circle size={14} strokeWidth={0} fill="currentColor" />
      </Button>

  <!-- Source. Hidden once recording starts — the source is locked in, so the
       selector just takes space; dropping it is part of the collapse. The
       fade lives on a wrapping div because Svelte transitions can't bind to a
       component directly. -->
  {#if !isRecording}
  <div class="inline-flex" out:fade={{ duration: 120 }}>
  <Button
    size="sm"
    disabled={isRecording}
    onclick={openSourceSelector}
    onmousedown={(e: MouseEvent) => e.stopPropagation()}
    variant="ghost"
    class="group/source hover:scale-none"
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
  </div>
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
        onclick={toggleSystemAudio}
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
    </div>
  {/if}
  </div>
</div>
</div>
