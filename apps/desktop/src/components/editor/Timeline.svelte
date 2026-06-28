<script lang="ts">
  import type {
    EditorStore,
    ZoomRegion,
  } from "$lib/stores/editor-store.svelte";
  import { experimentalStore } from "$lib/stores/experimental.svelte";
  import { Eye, EyeOff, Film, Pencil, Scissors, Target } from "@lucide/svelte";
  import { onMount } from "svelte";
  import TimelineAnnotationLane from "./_components/timeline/TimelineAnnotationLane.svelte";
  import TimelineClipBar from "./_components/timeline/TimelineClipBar.svelte";
  import TimelineCutLane from "./_components/timeline/TimelineCutLane.svelte";
  import TimelinePlayhead from "./_components/timeline/TimelinePlayhead.svelte";
  import TimelineRuler from "./_components/timeline/TimelineRuler.svelte";
  import TimelineToolbar from "./_components/timeline/TimelineToolbar.svelte";
  import TimelineZoomLane from "./_components/timeline/TimelineZoomLane.svelte";
  import {
    effectiveFps as effFps,
    formatTimeByMode,
    frameStep as frameStepOf,
    greatestCommonDivisor,
    minClipDuration as minClipDurOf,
    quantizeToFrame as quantizeToFrameOf,
    type TimeMode,
  } from "./_components/timeline/timeline-helpers";
  import { originalToOutput, outputToOriginal } from "$lib/timeline/time-map";
  import type { TileProvider } from "$lib/timeline/filmstrip-source";

  // Orchestrator: owns the scroll container, sizing, transport (JKL/speed),
  // keyboard routing, and the click-to-seek scrubber. Subviews live under `_components/timeline/`.

  interface Props {
    store: EditorStore;
    videoEl?: HTMLVideoElement | null;
    tileProvider?: TileProvider | null;
    filmstripVersion?: number;
  }

  let {
    store,
    videoEl = null,
    tileProvider = null,
    filmstripVersion = 0,
  }: Props = $props();

  let timelineEl: HTMLDivElement | undefined = $state();
  let isDraggingPlayhead = $state(false);
  let timelineWidth = $state(900);
  // Horizontal scroll offset, tracked so the clip bar can virtualize its tiles.
  let scrollLeft = $state(0);
  // Left padding (px-2) between the scroller and the lane content the clip bar
  // positions against — subtracted so the viewport lands in clip-bar coords.
  const LANE_PAD = 8;

  const SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0] as const;
  let playbackSpeed = $state(1.0);

  // Lives in the orchestrator so one click flips every timeline label at once.
  let timeMode = $state<TimeMode>("smpte");

  // JKL transport (Avid/Premiere): consecutive L/J cycles 1×→2×→4×, K parks.
  // J drives reverse via a rAF loop (browsers don't reliably support negative playbackRate).
  let shuttleDirection = $state<-1 | 0 | 1>(0);
  let shuttleSpeedIndex = $state(0);
  const SHUTTLE_SPEEDS = [1, 2, 4];
  let reverseFrame = 0;

  $effect(() => {
    if (videoEl) {
      videoEl.playbackRate =
        shuttleDirection === 1
          ? SHUTTLE_SPEEDS[shuttleSpeedIndex] * playbackSpeed
          : playbackSpeed;
    }
  });

  // Reverse-play loop. Held active only while shuttleDirection === -1.
  function pumpReverse() {
    if (shuttleDirection !== -1 || !videoEl) {
      reverseFrame = 0;
      return;
    }
    const f = effectiveFps();
    const step = (SHUTTLE_SPEEDS[shuttleSpeedIndex] / f) * playbackSpeed;
    const next = Math.max(store.inPoint, store.currentTime - step);
    store.currentTime = next;
    videoEl.currentTime = next;
    if (next <= store.inPoint) {
      shuttleDirection = 0;
      shuttleSpeedIndex = 0;
      reverseFrame = 0;
      return;
    }
    reverseFrame = requestAnimationFrame(pumpReverse);
  }

  $effect(() => {
    if (shuttleDirection === -1 && reverseFrame === 0) {
      reverseFrame = requestAnimationFrame(pumpReverse);
    } else if (shuttleDirection !== -1 && reverseFrame !== 0) {
      cancelAnimationFrame(reverseFrame);
      reverseFrame = 0;
    }
  });

  // Trim/playhead writes round to the nearest frame so preview and export agree
  // on the first/last kept frame; sub-frame values cause off-by-one mismatches.
  function effectiveFps(): number {
    return effFps(store.metadata?.fps);
  }
  function quantizeToFrame(time: number): number {
    return quantizeToFrameOf(time, effectiveFps());
  }
  function frameStep(): number {
    return frameStepOf(effectiveFps());
  }
  function minClipDuration(): number {
    return minClipDurOf(effectiveFps());
  }

  function zoomTimeline(dir: number) {
    store.timelineZoom = Math.max(
      0.5,
      Math.min(5, store.timelineZoom + dir * 0.25),
    );
  }

  // timelineZoom=1 means "duration spans timelineWidth", so fit is just 1.0.
  function zoomToFit() {
    store.timelineZoom = 1;
    requestAnimationFrame(() => {
      if (timelineEl) timelineEl.scrollLeft = 0;
    });
  }

  // Selected region fills ~70% of the viewport (0.7 leaves context on both sides).
  function zoomToSelection() {
    if (!timelineEl || duration <= 0) return;
    const id = store.selectedZoomRegionId;
    if (!id) return;
    const region = store.zoomRegions.find((r) => r.id === id);
    if (!region) return;
    const span = Math.max(0.001, region.end - region.start);
    const target = (duration / span) * 0.7;
    const nextZoom = Math.max(0.5, Math.min(5, target));
    store.timelineZoom = nextZoom;
    requestAnimationFrame(() => {
      if (!timelineEl || outputDuration <= 0) return;
      const nextPps = (timelineEl.clientWidth * nextZoom) / outputDuration;
      // Center on the region's midpoint in OUTPUT pixels.
      const center = (region.start + region.end) * 0.5;
      timelineEl.scrollLeft = Math.max(
        0,
        originalToOutput(store.timeMap, center) * nextPps - timelineEl.clientWidth * 0.5,
      );
    });
  }

  // Output seconds under the pointer, BEFORE the time-map. Trim drags map this
  // through a map FROZEN at drag-start, so the collapsed clip's left edge (which
  // sits at output 0) isn't a degenerate input.
  function clientXToOutput(clientX: number): number {
    if (!timelineEl || pixelsPerSecond <= 0) return 0;
    const rect = timelineEl.getBoundingClientRect();
    return Math.max(
      0,
      (clientX - rect.left + timelineEl.scrollLeft) / pixelsPerSecond,
    );
  }

  // For the global Alt+[ / Alt+] shortcuts (trim handles have their own arrows in TimelineClipBar).
  function nudgeTrim(which: "in" | "out", direction: 1 | -1, second = false) {
    if (duration <= 0) return;
    store.pushUndoStateCoalesced(`trim-${which}`, 500);
    const delta = direction * (second ? 1 : frameStep());
    const min = minClipDuration();
    if (which === "in") {
      const next = quantizeToFrame(
        Math.max(0, Math.min(store.outPoint - min, store.inPoint + delta)),
      );
      store.trimStart = next;
    } else {
      const next = quantizeToFrame(
        Math.max(
          store.inPoint + min,
          Math.min(duration, store.outPoint + delta),
        ),
      );
      store.trimEnd = next;
    }
  }

  const duration = $derived(store.metadata?.duration ?? 0);
  // The axis is OUTPUT time via `store.timeMap`: cuts collapse to zero width (NLE
  // ripple) and each kept segment is warped by its per-segment speed. Trimmed
  // head/tail stay as 1x context, so the in/out handles still bracket the clip.
  const outputDuration = $derived(store.timeMap.outputDuration);
  const pixelsPerSecond = $derived(
    outputDuration > 0 ? (timelineWidth * store.timelineZoom) / outputDuration : 100,
  );
  const totalWidth = $derived(
    Math.max(outputDuration * pixelsPerSecond, timelineWidth),
  );
  // Canonical axis transforms — every lane positions with `xOf` and resolves pointers with `tOf`.
  const xOf = (t: number) => originalToOutput(store.timeMap, t) * pixelsPerSecond;
  const tOf = (x: number) => outputToOriginal(store.timeMap, x / pixelsPerSecond);
  const clipLeft = $derived(xOf(store.inPoint));
  const clipRight = $derived(xOf(store.outPoint));
  const clipWidth = $derived(Math.max(clipRight - clipLeft, 0));
  const thumbnailWidth = $derived(
    store.thumbnailStrip.length > 0
      ? Math.max(88, clipWidth / store.thumbnailStrip.length)
      : 112,
  );
  const hasTrim = $derived(
    duration > 0 && (store.inPoint > 0 || store.outPoint < duration),
  );
  const frameCount = $derived(
    Math.max(
      0,
      Math.round((store.metadata?.duration ?? 0) * (store.metadata?.fps ?? 0)),
    ),
  );
  const aspectRatioLabel = $derived.by(() => {
    const width = store.metadata?.width ?? 0;
    const height = store.metadata?.height ?? 0;
    if (!width || !height) return "Source";
    const divisor = greatestCommonDivisor(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  });

  function seekToPosition(clientX: number) {
    if (!timelineEl || duration <= 0) return;
    const rect = timelineEl.getBoundingClientRect();
    const scrollLeft = timelineEl.scrollLeft;
    const x = clientX - rect.left + scrollLeft;
    // OUTPUT px → original time via the cut model (raw `x / pps` would make the playhead trail past each cut).
    const time = Math.max(0, Math.min(duration, tOf(x)));
    store.currentTime = time;
    if (videoEl) videoEl.currentTime = time;
  }

  function handleTimelinePointerDown(event: PointerEvent) {
    isDraggingPlayhead = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seekToPosition(event.clientX);
  }

  function handleTimelinePointerMove(event: PointerEvent) {
    updateHover(event.clientX);
    if (!isDraggingPlayhead) return;
    seekToPosition(event.clientX);
  }

  function handleTimelinePointerUp() {
    isDraggingPlayhead = false;
  }

  // Hover-scrub: a frame thumbnail (decoded by the filmstrip provider) follows
  // the cursor over the timeline, with the output timecode under it.
  let hover = $state<{
    clientX: number;
    top: number;
    outputSec: number;
    originalSec: number;
  } | null>(null);
  const hoverUrl = $derived.by(() => {
    void filmstripVersion;
    if (!hover || !tileProvider) return undefined;
    return tileProvider.previewAt(hover.originalSec);
  });

  function updateHover(clientX: number) {
    if (!timelineEl || isDraggingPlayhead || duration <= 0) {
      hover = null;
      return;
    }
    const rect = timelineEl.getBoundingClientRect();
    const xInViewport = clientX - rect.left;
    if (xInViewport < 0 || xInViewport > rect.width) {
      hover = null;
      return;
    }
    const outputSec = clientXToOutput(clientX);
    hover = {
      clientX,
      top: rect.top,
      outputSec,
      originalSec: outputToOriginal(store.timeMap, outputSec),
    };
  }
  function clearHover() {
    hover = null;
  }

  function handleTimelineKeydown(event: KeyboardEvent) {
    if (duration <= 0) return;

    const mod = event.ctrlKey || event.metaKey;

    // Paste works anywhere in the timeline (cards own copy/duplicate — they need focus).
    if (mod && (event.key === "v" || event.key === "V")) {
      if (zoomClipboard) {
        event.preventDefault();
        pasteRegion();
      }
      return;
    }

    // Bail on Ctrl/Cmd so a global combo (⌘K/⌘J/⌘S) doesn't also fire a single-letter transport here.
    if (mod) return;

    const step = event.shiftKey ? 1 : frameStep();

    if (event.key === "ArrowLeft" && !event.altKey) {
      event.preventDefault();
      const next = quantizeToFrame(Math.max(0, store.currentTime - step));
      store.currentTime = next;
      if (videoEl) videoEl.currentTime = next;
    }

    if (event.key === "ArrowRight" && !event.altKey) {
      event.preventDefault();
      const next = quantizeToFrame(
        Math.min(duration, store.currentTime + step),
      );
      store.currentTime = next;
      if (videoEl) videoEl.currentTime = next;
    }

    // Premiere-style in/out point shortcuts.
    if (event.key === "i" || event.key === "I") {
      event.preventDefault();
      if (event.shiftKey) {
        store.pushUndoState();
        store.trimStart = 0;
      } else {
        setTrimPoint("in");
      }
    }
    if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      if (event.shiftKey) {
        store.pushUndoState();
        store.trimEnd = duration;
      } else {
        setTrimPoint("out");
      }
    }

    // Alt+[ shrinks from head, Alt+] from tail (Shift = 1s). Match `event.code` —
    // shifted brackets become "{"/"}" on some layouts.
    if (event.altKey && event.code === "BracketLeft") {
      event.preventDefault();
      nudgeTrim("in", 1, event.shiftKey);
    }
    if (event.altKey && event.code === "BracketRight") {
      event.preventDefault();
      nudgeTrim("out", -1, event.shiftKey);
    }

    // Home/End jump the playhead to the in/out points (NLE convention).
    if (event.key === "Home") {
      event.preventDefault();
      const t = store.inPoint;
      store.currentTime = t;
      if (videoEl) videoEl.currentTime = t;
    }
    if (event.key === "End") {
      event.preventDefault();
      const t = Math.max(store.inPoint, store.outPoint - frameStep());
      store.currentTime = t;
      if (videoEl) videoEl.currentTime = t;
    }

    // Split the clip at the playhead (NLE razor — "S").
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      store.splitAt(store.currentTime);
    }

    // Ripple-delete the selected clip (or the one under the playhead); store returns the join to land on a kept frame.
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const target = store.selectedClipStart ?? store.currentTime;
      const joinAt = store.deleteSegmentAt(target);
      if (joinAt !== null) {
        store.currentTime = joinAt;
        if (videoEl) videoEl.currentTime = joinAt;
      }
    }

    // J/K/L transport (see shuttle state above).
    if (event.key === "k" || event.key === "K") {
      event.preventDefault();
      shuttleDirection = 0;
      shuttleSpeedIndex = 0;
      if (videoEl) videoEl.pause();
      store.isPlaying = false;
    }
    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      if (shuttleDirection === 1) {
        shuttleSpeedIndex = Math.min(
          SHUTTLE_SPEEDS.length - 1,
          shuttleSpeedIndex + 1,
        );
      } else {
        shuttleDirection = 1;
        shuttleSpeedIndex = 0;
      }
      if (videoEl) {
        videoEl.playbackRate =
          SHUTTLE_SPEEDS[shuttleSpeedIndex] * playbackSpeed;
        void videoEl.play();
      }
      store.isPlaying = true;
    }
    if (event.key === "j" || event.key === "J") {
      event.preventDefault();
      if (videoEl) videoEl.pause();
      store.isPlaying = false;
      if (shuttleDirection === -1) {
        shuttleSpeedIndex = Math.min(
          SHUTTLE_SPEEDS.length - 1,
          shuttleSpeedIndex + 1,
        );
      } else {
        shuttleDirection = -1;
        shuttleSpeedIndex = 0;
      }
    }
  }

  function handleResize() {
    if (!timelineEl) return;
    timelineWidth = timelineEl.clientWidth;
  }

  function handleScroll() {
    if (timelineEl) scrollLeft = timelineEl.scrollLeft;
  }

  function handleTimelineWheel(event: WheelEvent) {
    if (!timelineEl) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = timelineEl.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      // Anchor in OUTPUT seconds so the point under the cursor stays put across the zoom.
      const anchorOut =
        duration > 0 ? (timelineEl.scrollLeft + anchorX) / pixelsPerSecond : 0;
      const delta = event.deltaY < 0 ? 0.2 : -0.2;
      const nextZoom = Math.max(0.5, Math.min(5, store.timelineZoom + delta));
      if (nextZoom === store.timelineZoom) return;
      store.timelineZoom = nextZoom;
      requestAnimationFrame(() => {
        if (!timelineEl || outputDuration <= 0) return;
        const nextPixelsPerSecond =
          (timelineEl.clientWidth * nextZoom) / outputDuration;
        timelineEl.scrollLeft = Math.max(
          0,
          anchorOut * nextPixelsPerSecond - anchorX,
        );
      });
      return;
    }

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      timelineEl.scrollLeft += event.deltaY;
    }
  }

  function syncVideoTime() {
    if (!videoEl) return;
    videoEl.currentTime = Math.max(0, Math.min(duration, store.currentTime));
  }

  function addFocusRegion() {
    if (duration <= 0) return;
    const start = Math.max(store.inPoint, store.currentTime - 0.35);
    const end = Math.min(
      store.outPoint,
      Math.max(start + 0.8, store.currentTime + 0.85),
    );
    store.addZoomRegion(start, end, 1.8);
  }

  function setTrimPoint(kind: "in" | "out") {
    if (duration <= 0) return;
    store.pushUndoState();
    const min = minClipDuration();
    if (kind === "in") {
      const nextIn = quantizeToFrame(
        Math.min(store.currentTime, Math.max(0, store.outPoint - min)),
      );
      store.trimStart = nextIn;
      if (store.currentTime < nextIn) store.currentTime = nextIn;
    } else {
      const nextOut = quantizeToFrame(
        Math.max(store.currentTime, Math.min(duration, store.inPoint + min)),
      );
      store.trimEnd = nextOut;
      if (store.currentTime > nextOut) store.currentTime = nextOut;
    }
    syncVideoTime();
  }

  // Editable fields only — id/source are regenerated on paste so it never collides with an existing region.
  type ZoomClipboard = Omit<ZoomRegion, "id" | "source">;
  let zoomClipboard = $state<ZoomClipboard | null>(null);

  function snapshotForClipboard(r: ZoomRegion): ZoomClipboard {
    return {
      start: r.start,
      end: r.end,
      scale: r.scale,
      easeIn: { ...r.easeIn },
      easeOut: { ...r.easeOut },
      rampIn: r.rampIn,
      rampOut: r.rampOut,
      centerX: r.centerX,
      centerY: r.centerY,
      motionBlur: r.motionBlur,
    };
  }

  function copyRegion(r: ZoomRegion) {
    zoomClipboard = snapshotForClipboard(r);
  }

  // Place a region at `startAt`, copying the rest from `template`.
  function placeRegion(template: ZoomClipboard, startAt: number) {
    if (duration <= 0) return;
    const span = template.end - template.start;
    const start = Math.max(0, Math.min(duration - span, startAt));
    const end = start + span;
    // addZoomRegion only seeds geometry/scale; layer the rest on so the copy matches the source.
    const id = store.addZoomRegion(start, end, template.scale, {
      x: template.centerX,
      y: template.centerY,
    });
    store.updateZoomRegion(id, {
      easeIn: { ...template.easeIn },
      easeOut: { ...template.easeOut },
      rampIn: template.rampIn,
      rampOut: template.rampOut,
      motionBlur: template.motionBlur,
    });
  }

  function duplicateRegion(r: ZoomRegion) {
    const span = r.end - r.start;
    // Offset by min(0.25s, span) so the copy sits visibly right without overshooting.
    const offset = Math.min(0.25, span);
    placeRegion(snapshotForClipboard(r), r.start + offset);
  }

  // Store nudges the geometry diagonally; we add a +0.25s time shift on top.
  function duplicateAnnotation(
    annotation: import("$lib/stores/editor-store.svelte").Annotation,
  ) {
    if (duration <= 0) return;
    const dup = store.duplicateAnnotation(annotation.id);
    if (!dup) return;
    const span = dup.end - dup.start;
    const offset = Math.min(0.25, span);
    const nextStart = Math.max(0, Math.min(duration - span, dup.start + offset));
    store.updateAnnotation(dup.id, {
      start: nextStart,
      end: nextStart + span,
    });
  }

  function pasteRegion() {
    if (!zoomClipboard) return;
    const span = zoomClipboard.end - zoomClipboard.start;
    placeRegion(zoomClipboard, store.currentTime - span * 0.5);
  }

  function resetTrim() {
    store.pushUndoState();
    store.trimStart = 0;
    store.trimEnd = duration;
    syncVideoTime();
  }

  onMount(() => {
    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (timelineEl) observer.observe(timelineEl);
    return () => observer.disconnect();
  });
</script>

<!-- Track-header chip for the fixed left rail. -->
{#snippet railLabel(Icon: typeof Film, label: string, chipClass: string)}
  <span
    class="inline-flex items-center gap-1 rounded-sm px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-wider {chipClass}"
  >
    <Icon class="size-2" />
    {label}
  </span>
{/snippet}

{#snippet railEye(visible: boolean, toggle: () => void, title: string)}
  <button
    type="button"
    onclick={toggle}
    {title}
    aria-label={title}
    aria-pressed={!visible}
    class="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  >
    {#if visible}
      <Eye class="size-2.5" />
    {:else}
      <EyeOff class="size-2.5" />
    {/if}
  </button>
{/snippet}

<div
  class="shrink-0 select-none border-t border-border/60 bg-card/30 px-2 pt-1.5 pb-2"
>
  <TimelineToolbar
    {store}
    fps={effectiveFps()}
    {hasTrim}
    {aspectRatioLabel}
    {frameCount}
    {playbackSpeed}
    speeds={SPEEDS}
    {timeMode}
    hasSelectedRegion={!!store.selectedZoomRegionId}
    onSetTrim={setTrimPoint}
    onSplit={() => store.splitAt(store.currentTime)}
    onAddFocusRegion={addFocusRegion}
    onResetTrim={resetTrim}
    onZoomTimeline={zoomTimeline}
    onSelectSpeed={(speed) => (playbackSpeed = speed)}
    onSetTimeMode={(mode) => (timeMode = mode)}
    onZoomToFit={zoomToFit}
    onZoomToSelection={zoomToSelection}
  />

  <!-- Rail lives OUTSIDE the scroller so lane names never overlap a card at t≈0.
       Row heights mirror the track side (h-7 ruler, h-12 clip, mt-1.5+min-h-9 lanes) so labels align. -->
  <div
    class="relative flex overflow-hidden rounded-xl border border-border/60 bg-background/60 shadow-(--shadow-craft-inset)"
  >
    <div
      class="relative z-10 flex w-20 shrink-0 flex-col border-r border-border/60 bg-card/50"
    >
      <!-- Aligns with the ruler -->
      <div class="h-7 border-b border-border/60"></div>
      <div class="px-1.5 pb-2 pt-1.5">
        <!-- Clip (no toggle) -->
        <div class="flex h-12 items-center">
          {@render railLabel(Film, "Clip", "bg-foreground/10 text-foreground/80")}
        </div>
        <!-- Focus -->
        <div class="mt-1.5 flex min-h-9 items-center justify-between gap-1">
          {@render railLabel(Target, "Focus", "bg-primary/15 text-primary")}
          {@render railEye(
            store.focusEnabled,
            () => (store.focusEnabled = !store.focusEnabled),
            store.focusEnabled
              ? "Disable focus (regions stay; preview & export ignore them)"
              : "Enable focus",
          )}
        </div>
        <!-- Notes -->
        <div class="mt-1.5 flex min-h-9 items-center justify-between gap-1">
          {@render railLabel(Pencil, "Notes", "bg-warning/15 text-warning")}
          {@render railEye(
            !store.annotationsGloballyHidden,
            () =>
              (store.annotationsGloballyHidden = !store.annotationsGloballyHidden),
            store.annotationsGloballyHidden
              ? "Enable notes"
              : "Disable notes (annotations stay; preview & export ignore them)",
          )}
        </div>
        {#if experimentalStore.silenceDetection}
          <!-- Cuts -->
          <div class="mt-1.5 flex min-h-9 items-center justify-between gap-1">
            {@render railLabel(Scissors, "Cuts", "bg-destructive/15 text-destructive")}
            {@render railEye(
              store.cutsEnabled,
              () => (store.cutsEnabled = !store.cutsEnabled),
              store.cutsEnabled
                ? "Disable cuts (cuts stay; playback & export ignore them)"
                : "Enable cuts",
            )}
          </div>
        {/if}
      </div>
    </div>

    <div
      bind:this={timelineEl}
      role="slider"
      tabindex="0"
      aria-label="Timeline scrubber"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={store.currentTime}
      class="custom-scrollbar relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      onpointerdown={handleTimelinePointerDown}
      onpointermove={handleTimelinePointerMove}
      onpointerup={handleTimelinePointerUp}
      onpointercancel={handleTimelinePointerUp}
      onwheel={handleTimelineWheel}
      onscroll={handleScroll}
      onpointerleave={clearHover}
      onkeydown={handleTimelineKeydown}
    >
      <div
        class="relative min-w-full"
        style="width: {totalWidth}px; height: {experimentalStore.silenceDetection ? 250 : 204}px;"
      >
        <TimelineRuler duration={outputDuration} {pixelsPerSecond} />

      <div class="relative px-2 pb-2 pt-1.5">
        <TimelineClipBar
          {store}
          {videoEl}
          fps={effectiveFps()}
          {duration}
          {pixelsPerSecond}
          {clipLeft}
          {clipWidth}
          {thumbnailWidth}
          {timeMode}
          {clientXToOutput}
          {tileProvider}
          {filmstripVersion}
          viewportLeftPx={Math.max(0, scrollLeft - LANE_PAD)}
          viewportWidthPx={timelineWidth}
        />

        <TimelineZoomLane
          {store}
          {pixelsPerSecond}
          fps={effectiveFps()}
          {duration}
          {timeMode}
          onCopy={copyRegion}
          onDuplicate={duplicateRegion}
        />

        <TimelineAnnotationLane
          {store}
          {pixelsPerSecond}
          fps={effectiveFps()}
          {duration}
          {timeMode}
          onDuplicate={duplicateAnnotation}
        />

        {#if experimentalStore.silenceDetection}
          <TimelineCutLane {store} {pixelsPerSecond} {duration} />
        {/if}
      </div>

      <TimelinePlayhead
        currentTime={store.currentTime}
        leftPx={xOf(store.currentTime)}
        fps={effectiveFps()}
        isDragging={isDraggingPlayhead}
        {timeMode}
        tall={experimentalStore.silenceDetection}
      />
      </div>
    </div>
  </div>
</div>

<!-- Hover-scrub preview: fixed so it floats above the timeline without being
     clipped by the scroller's overflow. Only with the WebCodecs filmstrip. -->
{#if hover && tileProvider && !isDraggingPlayhead}
  <div
    class="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1"
    style="left: {hover.clientX}px; top: {hover.top - 8}px;"
  >
    <div
      class="overflow-hidden rounded-md border border-border/70 bg-card shadow-lg"
    >
      {#if hoverUrl}
        <img
          src={hoverUrl}
          alt=""
          class="block h-16 w-auto object-cover"
          draggable="false"
        />
      {:else}
        <div class="h-16 w-28 animate-pulse bg-muted/60"></div>
      {/if}
    </div>
    <span
      class="rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground shadow-sm"
    >
      {formatTimeByMode(hover.outputSec, timeMode, effectiveFps())}
    </span>
  </div>
{/if}

<style>
  .custom-scrollbar::-webkit-scrollbar {
    height: 8px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(120, 120, 128, 0.35);
    border-radius: 999px;
  }

  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(120, 120, 128, 0.35) transparent;
  }
</style>
