<script lang="ts">
  import {
    Circle,
    FlipHorizontal2,
    LoaderCircle,
    Maximize2,
    Square,
    Squircle,
    X,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { listen } from "@tauri-apps/api/event";
  import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";

  import {
    CameraNotFoundError,
    openCameraStream,
  } from "$lib/camera/browser-devices";
  import {
    setWindowAspectRatio,
    updateCameraPreviewState,
    validateCameraSource,
    type CameraPreviewState,
  } from "$lib/ipc";

  type AspectKey = "1:1" | "4:3" | "16:9";
  type ShapeKey = "square" | "rounded" | "circle";
  type CameraStatus = "loading" | "live" | "warning" | "failed";

  const ASPECTS: AspectKey[] = ["1:1", "4:3", "16:9"];
  const ASPECT_RATIO: Record<AspectKey, number> = {
    "1:1": 1,
    "4:3": 4 / 3,
    "16:9": 16 / 9,
  };

  // Shape options offered per aspect. Circle is 1:1-only — applying it to
  // a non-square aspect produces an ellipse, which is rarely what the user
  // wants and which the composited bubble in the editor doesn't render.
  function allowedShapesFor(a: AspectKey): ShapeKey[] {
    return a === "1:1"
      ? ["square", "rounded", "circle"]
      : ["square", "rounded"];
  }

  // Window radius in CSS pixels for the "rounded" shape — matches the
  // rounded-3xl token visually. "square" uses 0; "circle" uses a half-side
  // radius and is only allowed on 1:1 aspect.
  const WINDOW_RADIUS = 20;

  // Resize bounds, expressed as fractions of the primary screen's available
  // logical dimensions. The cap exists because an oversized live preview
  // (a) covers content the user is recording, and (b) makes the eventual
  // composited bubble look ridiculous if the user accidentally records at
  // that size. 25% of either axis is comfortably visible without dominating
  // the frame.
  const MAX_SCREEN_FRACTION = 0.25;
  // Floor: small enough to tuck into a corner, large enough that the live
  // feed remains intelligible. ~120 logical px ≈ a thumbnail.
  const MIN_LOGICAL_SIZE = 120;

  // Fixed-height strip reserved at the *bottom* of the window for the control
  // bar. The bar lives outside the rounded/overflow-hidden video bubble so it
  // never gets clipped by the circle/rounded mask and never sits over the
  // camera feed. The window is this much taller than the video; the aspect
  // lock (native + JS) only governs `windowHeight − CONTROL_BAR_HEIGHT`, and
  // the preview state reports just the video rect so the recorded composite is
  // unaffected. Keep in sync with the strip height in the markup below and the
  // initial window height in `openCameraPreviewWindow` (ipc.ts).
  const CONTROL_BAR_HEIGHT = 40;

  // Cached max logical size for the current screen — recomputed on mount and
  // whenever a resize crosses screens. Used by the aspect-snap helpers to
  // clamp the box before calling setSize, since the OS-level max-size only
  // bounds drag-resize and not our programmatic snap-to-aspect calls.
  let maxLogicalW = $state(640);
  let maxLogicalH = $state(360);

  let videoEl: HTMLVideoElement | null = $state(null);
  let stream: MediaStream | null = $state(null);
  let errorMessage: string | null = $state(null);
  let statusMessage = $state("Connecting to camera…");
  let status = $state<CameraStatus>("loading");
  let isMirrored = $state(true);
  let aspect = $state<AspectKey>("1:1");
  let shape = $state<ShapeKey>("rounded");
  let liveProbeTimer: number | null = $state(null);
  let videoFrameSeen = $state(false);
  let isSnapping = false;

  const params = new URLSearchParams(window.location.search);
  // Accept both legacy DirectShow names (passed as `deviceId` historically)
  // and real browser MediaDevices ids — `openCameraStream` handles either.
  const deviceQuery = params.get("deviceId");

  $effect(() => {
    if (videoEl && stream) {
      videoEl.srcObject = stream;
    }
  });

  onMount(() => {
    // Make the WebView itself fully see-through so the inner rounded
    // container is the only thing that paints — the OS window already has
    // `transparent: true`, so corners outside the radius show the desktop.
    const html = document.documentElement;
    const body = document.body;
    html.style.background = "transparent";
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "auto";
    (html.style as CSSStyleDeclaration & { scrollbarWidth?: string }).scrollbarWidth =
      "none";
    body.style.background = "transparent";
    body.style.overflow = "hidden";
    body.style.margin = "0";

    void applySizeConstraints();
    void startCamera();
    void applyAspect(aspect, { snap: true });

    const unlistenStop = listen("camera-stop", () => {
      stopCamera();
      getCurrentWindow().close();
    });
    const unlistenStarted = listen<{ startedAtUnixMs: number }>(
      "camera-recording-started",
      () => {
        void reportPreviewState();
      },
    );
    const unlistenStopped = listen("camera-recording-stopped", () => {});

    // Event-driven preview state push: only fire on actual window changes
    // (move/resize) or user toggles (aspect/mirror). Replaces the old 350ms
    // poll that did three IPC round-trips/sec into a Rust mutex even when
    // nothing changed.
    const unlistenResize = getCurrentWindow().onResized(({ payload }) => {
      void snapToAspect(payload.width, payload.height);
      void reportPreviewState();
    });
    const unlistenMove = getCurrentWindow().onMoved(() => {
      void reportPreviewState();
    });

    return () => {
      stopCamera();
      if (liveProbeTimer !== null) window.clearTimeout(liveProbeTimer);
      unlistenStop.then((fn) => fn());
      unlistenStarted.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
      unlistenResize.then((fn) => fn());
      unlistenMove.then((fn) => fn());
    };
  });

  async function startCamera() {
    try {
      errorMessage = null;
      status = "loading";
      statusMessage = "Connecting to camera…";

      // Validation is best-effort and only meaningful for DirectShow names;
      // skip silently if the query is a browser deviceId hash (validation
      // would always fail on those).
      if (deviceQuery && !/^[a-f0-9]{40,}$/i.test(deviceQuery)) {
        try {
          const validation = await validateCameraSource(deviceQuery);
          if (validation.status === "warning" || validation.status === "error") {
            status = validation.status === "error" ? "failed" : "warning";
            statusMessage =
              validation.statusMessage ?? "Camera source requires validation.";
          }
        } catch {
          // Non-fatal — preview can still open via browser enumeration.
        }
      }

      const { stream: openedStream, camera } = await openCameraStream(
        deviceQuery,
      );
      stream = openedStream;
      console.info(
        `[camera-preview] opened ${camera.label} (virtual=${camera.isVirtual})`,
      );

      startLivelinessProbe();
      window.setTimeout(() => {
        void reportPreviewState();
      }, 150);
    } catch (e) {
      const msg =
        e instanceof CameraNotFoundError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      console.error("Camera access failed:", e);
      errorMessage = msg;
      status = "failed";
      statusMessage = msg;
    }
  }

  function startLivelinessProbe() {
    videoFrameSeen = false;

    const markLive = () => {
      if (!videoEl) return;
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        videoFrameSeen = true;
        if (status !== "failed") {
          status = "live";
          statusMessage = "Camera live";
        }
      }
    };

    const interval = window.setInterval(() => {
      markLive();
      if (videoFrameSeen) window.clearInterval(interval);
    }, 150);

    liveProbeTimer = window.setTimeout(() => {
      window.clearInterval(interval);
      if (!videoFrameSeen && status !== "failed") {
        status = "warning";
        statusMessage = "Camera opened but no live frames arrived.";
      }
    }, 2200);
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function closeWindow() {
    stopCamera();
    getCurrentWindow().close();
  }

  /**
   * Compute and apply OS-level min/max size constraints. The cap is keyed off
   * the screen's available *width* (`MAX_SCREEN_FRACTION` of it) — every aspect
   * we offer is landscape-or-square (ratio ≥ 1), so height is always ≤ width
   * and a square max box of side `0.25·screenW` bounds the window by width
   * without ever clipping the proportional height. Called once on mount; the
   * aspect-snap helpers clamp against `maxLogicalW/H` on top so programmatic
   * setSize calls (cycling aspect) can't punch past the cap.
   */
  async function applySizeConstraints() {
    const screenW = Math.max(window.screen.availWidth || 1920, 320);
    const maxW = Math.floor(screenW * MAX_SCREEN_FRACTION);
    // Square bounding box for the *video*: width is the binding limit, height
    // follows aspect. `maxLogicalW/H` are video dimensions; the window adds the
    // control strip on top.
    maxLogicalW = maxW;
    maxLogicalH = maxW;

    // Loosest min height across aspects (the widest, 16:9, gives the shortest
    // video for a given min width) so the OS floor never out-clamps the native
    // per-aspect minimum. Window bounds add the control strip.
    const widestRatio = Math.max(...Object.values(ASPECT_RATIO));
    const minWinH = Math.round(MIN_LOGICAL_SIZE / widestRatio) + CONTROL_BAR_HEIGHT;

    const win = getCurrentWindow();
    try {
      await win.setMinSize(new LogicalSize(MIN_LOGICAL_SIZE, minWinH));
      await win.setMaxSize(
        new LogicalSize(maxLogicalW, maxLogicalH + CONTROL_BAR_HEIGHT),
      );
    } catch (e) {
      console.warn("camera preview size constraints failed:", e);
    }

    // Install (or refresh) the native aspect lock for the current aspect.
    void applyNativeAspectLock();
  }

  /**
   * Hand the current aspect ratio to the Windows-native WM_SIZING constraint so
   * the window resizes *proportionally while dragging* — you can't pull width
   * or height independently, and it won't exceed MAX_SCREEN_FRACTION of the
   * monitor width. No-op off Windows, where the `snapToAspect` handler below is
   * the fallback. Re-invoked whenever the aspect changes so the ratio stays in
   * sync. The drag rect is in physical pixels, so the min crosses as such.
   */
  async function applyNativeAspectLock() {
    try {
      const ratio = ASPECT_RATIO[aspect];
      const dpr = window.devicePixelRatio || 1;
      await setWindowAspectRatio(
        "camera-preview",
        ratio,
        1,
        MAX_SCREEN_FRACTION,
        Math.round(MIN_LOGICAL_SIZE * dpr),
        Math.round(CONTROL_BAR_HEIGHT * dpr),
      );
    } catch (e) {
      // Non-Windows / older build — the JS snap-to-aspect path still applies.
      console.warn("native aspect lock unavailable:", e);
    }
  }

  /**
   * Fit a box of (w, h) with the given width/height ratio inside
   * (maxLogicalW, maxLogicalH) without breaking the ratio. Returns the
   * largest box that satisfies both bounds. Used by both `applyAspect`
   * (cycling aspect) and `snapToAspect` (height-snap after drag-resize)
   * since either path can derive a height that exceeds maxH on tall
   * aspects, or a width that exceeds maxW after a height-only drag.
   */
  function fitInsideMax(w: number, h: number, ratio: number): [number, number] {
    let outW = w;
    let outH = h;
    if (outW > maxLogicalW) {
      outW = maxLogicalW;
      outH = outW / ratio;
    }
    if (outH > maxLogicalH) {
      outH = maxLogicalH;
      outW = outH * ratio;
    }
    return [Math.round(outW), Math.round(outH)];
  }

  async function applyAspect(
    next: AspectKey,
    opts: { snap?: boolean } = {},
  ) {
    aspect = next;
    // Keep the native WM_SIZING ratio in lockstep with the chosen aspect so the
    // next drag is constrained to the new shape, not the previous one.
    void applyNativeAspectLock();
    if (opts.snap) {
      const win = getCurrentWindow();
      const size = await win.outerSize();
      const factor = window.devicePixelRatio || 1;
      // Window width == video width (no horizontal chrome).
      const widthLogical = size.width / factor;
      const ratio = ASPECT_RATIO[next];
      const [clampedW, clampedVideoH] = fitInsideMax(
        widthLogical,
        widthLogical / ratio,
        ratio,
      );
      isSnapping = true;
      // Window height = video height + control strip.
      await win.setSize(
        new LogicalSize(clampedW, clampedVideoH + CONTROL_BAR_HEIGHT),
      );
      window.setTimeout(() => {
        isSnapping = false;
      }, 50);
    }
    void reportPreviewState();
  }

  async function snapToAspect(physWidth: number, physHeight: number) {
    if (isSnapping) return;
    const factor = window.devicePixelRatio || 1;
    const w = physWidth / factor;
    // Drag deltas arrive as *window* dimensions — peel off the control strip to
    // get the video box the aspect ratio actually governs.
    const videoH = physHeight / factor - CONTROL_BAR_HEIGHT;
    const target = ASPECT_RATIO[aspect];
    const expectedVideoH = w / target;
    const [clampedW, clampedVideoH] = fitInsideMax(w, expectedVideoH, target);
    if (
      Math.abs(clampedVideoH - videoH) <= 1 &&
      Math.abs(clampedW - w) <= 1
    ) return;
    isSnapping = true;
    try {
      await getCurrentWindow().setSize(
        new LogicalSize(clampedW, clampedVideoH + CONTROL_BAR_HEIGHT),
      );
    } finally {
      window.setTimeout(() => {
        isSnapping = false;
      }, 50);
    }
  }

  function cycleAspect() {
    const nextIndex = (ASPECTS.indexOf(aspect) + 1) % ASPECTS.length;
    const next = ASPECTS[nextIndex];
    // Coerce circle → rounded when moving off 1:1. A circular border on a
    // non-square box renders as an ellipse, which is rarely desired and
    // isn't supported by the composited bubble in the editor either.
    if (next !== "1:1" && shape === "circle") {
      shape = "rounded";
    }
    void applyAspect(next, { snap: true });
  }

  function cycleShape() {
    const allowed = allowedShapesFor(aspect);
    const idx = allowed.indexOf(shape);
    // If current shape isn't in the allowed set (shouldn't happen, but
    // defensively), start from the first allowed option.
    shape = allowed[(idx === -1 ? 0 : idx + 1) % allowed.length];
    void reportPreviewState();
  }

  function toggleMirror() {
    isMirrored = !isMirrored;
    void reportPreviewState();
  }

  // CSS border-radius for the window's outer surface. `circle` uses 50%
  // (the box is always 1:1 in that case, so it's a true circle). `rounded`
  // matches the rounded-3xl design token; `square` is a hard cut.
  const cssRadius = $derived.by(() => {
    switch (shape) {
      case "circle":
        return "50%";
      case "square":
        return "0px";
      default:
        return `${WINDOW_RADIUS}px`;
    }
  });

  // Icon + tooltip for the current shape — drives the cycle button's label.
  const shapeMeta = $derived.by(() => {
    switch (shape) {
      case "circle":
        return { icon: Circle, label: "Circle" };
      case "square":
        return { icon: Square, label: "Square" };
      default:
        return { icon: Squircle, label: "Rounded" };
    }
  });

  async function reportPreviewState() {
    const win = getCurrentWindow();
    const position = await win.outerPosition();
    const size = await win.outerSize();
    const screenWidth = Math.max(window.screen.availWidth || 1, 1);
    const screenHeight = Math.max(window.screen.availHeight || 1, 1);

    const factor = window.devicePixelRatio || 1;
    // The control strip sits at the *bottom* of the window; the recorded bubble
    // is just the video region above it. Subtract the strip so the composite
    // (which uses windowWidth/Height as the bubble rect) matches what's on
    // screen and isn't stretched by the controls' height.
    const videoHeightPhys = Math.max(1, size.height - CONTROL_BAR_HEIGHT * factor);
    const widthLogical = size.width / factor;
    // Relative corner radius proportional to shorter side, capped at 0.5
    // (which paints as a full circle on a 1:1 box). Square → 0, circle →
    // 0.5, rounded → WINDOW_RADIUS scaled to fraction-of-shorter-side.
    const shortLogical = Math.min(widthLogical, videoHeightPhys / factor);
    const cornerRadius =
      shape === "square"
        ? 0
        : shape === "circle"
          ? 0.5
          : Math.min(0.5, WINDOW_RADIUS / Math.max(shortLogical, 1));

    const state: CameraPreviewState = {
      mirror: isMirrored,
      shape,
      cornerRadius,
      animationPreset: status === "warning" ? "lively" : "soft",
      // Window top == video top (strip is at the bottom), so X/Y are unchanged.
      windowX: Math.max(0, Math.min(1, position.x / screenWidth)),
      windowY: Math.max(0, Math.min(1, position.y / screenHeight)),
      windowWidth: Math.max(0.05, Math.min(1, size.width / screenWidth)),
      windowHeight: Math.max(0.05, Math.min(1, videoHeightPhys / screenHeight)),
    };

    await updateCameraPreviewState(state);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="group/root relative flex h-screen w-full select-none flex-col scroll-m-0 scrollbar-none"
  data-tauri-drag-region
>
  <!-- Video bubble — the ONLY clipped/rounded surface. `flex-1` makes it
       exactly the window height minus the control strip below, i.e. the video
       region the aspect lock governs. Controls live outside it (next sibling)
       so the rounded/circle mask never eats them. -->
  <div
    class="relative min-h-0 w-full flex-1 overflow-hidden bg-card transition-[border-radius] duration-150 ease-out motion-reduce:transition-none"
    data-tauri-drag-region
    style="border-radius: {cssRadius}"
  >
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={videoEl}
      autoplay
      playsinline
      muted
      class="pointer-events-none h-full w-full object-cover"
      style="transform: {isMirrored ? 'scaleX(-1)' : 'none'}"
    ></video>

    {#if status !== "live" || errorMessage}
      <div
        class="absolute inset-0 flex items-center justify-center bg-background/85 p-4 text-center backdrop-blur-md"
      >
        <div class="space-y-2">
          {#if status === "loading"}
            <LoaderCircle size={18} class="mx-auto animate-spin text-muted-foreground" />
          {/if}
          <p class="text-[11px] font-semibold text-foreground">
            {status === "failed" ? "Camera unavailable" : "Camera"}
          </p>
          <p class="max-w-[16rem] text-[10px] leading-relaxed text-muted-foreground">
            {errorMessage ?? statusMessage}
          </p>
        </div>
      </div>
    {/if}
  </div>

  <!-- Control strip — fixed-height row BELOW the bubble (outside its overflow),
       so the pill is never clipped and never overlaps the camera. The window
       reserves CONTROL_BAR_HEIGHT for it; the pill fades in on hover. -->
  <div
    class="flex w-full shrink-0 items-center justify-center"
    data-tauri-drag-region
    style="height: {CONTROL_BAR_HEIGHT}px"
  >
    <div
      class="pointer-events-none flex items-center gap-1 rounded-full border border-border-subtle bg-background/78 px-1 py-1 opacity-0 shadow-craft-floating backdrop-blur-3xl transition-opacity duration-200 group-hover/root:pointer-events-auto group-hover/root:opacity-100"
    >
      <Button
        onclick={cycleAspect}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        variant="ghost"
        size="sm"
        class="h-6 gap-1 rounded-full px-1.5 font-mono text-[10px] tabular-nums"
        title="Cycle aspect ratio"
      >
        <Maximize2 size={10} strokeWidth={2} />
        <span>{aspect}</span>
      </Button>

      {#snippet shapeIcon()}
        {@const SIcon = shapeMeta.icon}
        <SIcon size={11} strokeWidth={2} />
      {/snippet}
      <Button
        onclick={cycleShape}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        variant="ghost"
        size="icon-sm"
        class="size-6 rounded-full"
        title={aspect === "1:1"
          ? `Cycle shape: square → rounded → circle (now ${shapeMeta.label})`
          : `Cycle shape: square ↔ rounded (now ${shapeMeta.label})`}
      >
        {@render shapeIcon()}
      </Button>

      <Button
        onclick={toggleMirror}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        variant={isMirrored ? "default_soft" : "ghost"}
        size="icon-sm"
        class="size-6 rounded-full"
        title={isMirrored ? "Mirror: on (flip horizontally)" : "Mirror: off"}
      >
        <FlipHorizontal2 size={12} strokeWidth={2} />
      </Button>

      <div class="mx-0.5 h-3 w-px bg-border"></div>

      <Button
        onclick={closeWindow}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
        variant="destructive_soft"
        size="icon-sm"
        class="size-6 rounded-full"
        title="Close camera (Esc)"
      >
        <X size={11} strokeWidth={2.5} />
      </Button>
    </div>
  </div>
</div>

<style>
  /* Force-hide the scrollbar (and its reserved gutter) only for this page so
     the rounded corners read through to the desktop without a Windows
     scrollbar slot. The global stylesheet sets `scrollbar-gutter: stable`. */
  :global(html) {
    background: transparent !important;
    scrollbar-width: none;
    scrollbar-gutter: auto !important;
    overflow: hidden;
  }
  :global(body) {
    background: transparent !important;
    overflow: hidden;
    margin: 0;
  }
  :global(html::-webkit-scrollbar),
  :global(body::-webkit-scrollbar) {
    width: 0;
    height: 0;
    display: none;
  }
</style>
