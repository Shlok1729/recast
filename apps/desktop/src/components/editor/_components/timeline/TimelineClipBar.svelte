<script lang="ts">
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { experimentalStore } from "$lib/stores/experimental.svelte";
  import { Trash2 } from "@lucide/svelte";
  import { fade } from "svelte/transition";
  import {
    formatTimeByMode,
    formatTimecode,
    frameStep,
    minClipDuration,
    quantizeToFrame,
    type TimeMode,
  } from "./timeline-helpers";

  // Clip bar with thumbnails and the in/out trim handles. Owns its own
  // drag state — the parent only supplies `clientXToTime` so the
  // pointermove/up handlers can resolve absolute pointer X (already
  // including timeline scroll offset) into a clip time.

  interface Props {
    store: EditorStore;
    videoEl: HTMLVideoElement | null;
    fps: number;
    duration: number;
    clipLeft: number;
    clipWidth: number;
    thumbnailWidth: number;
    timeMode: TimeMode;
    clientXToTime: (clientX: number) => number;
  }

  let {
    store,
    videoEl,
    fps,
    duration,
    clipLeft,
    clipWidth,
    thumbnailWidth,
    timeMode,
    clientXToTime,
  }: Props = $props();

  // The clip lane renders one block per kept segment (split by the user or
  // carved out by cuts), so a split visibly produces two adjacent clips. All
  // positions are absolute timeline coordinates, derived from the parent's
  // clip box (clipLeft = inPoint·pps, clipWidth = clipDuration·pps), so blocks
  // stay pixel-aligned with the playhead and other lanes. `stripOffset` shifts
  // the shared thumbnail strip so each block shows its own slice.
  const clipDuration = $derived(Math.max(0.0001, store.outPoint - store.inPoint));
  const pps = $derived(clipWidth / clipDuration);
  const clipBlocks = $derived(
    store.segments.map((seg) => ({
      key: seg.start,
      start: seg.start,
      end: seg.end,
      left: clipLeft + (seg.start - store.inPoint) * pps,
      // -2px leaves a thin seam between adjacent clips so a split reads as two.
      width: Math.max(2, (seg.end - seg.start) * pps - 2),
      stripOffset: -(seg.start - store.inPoint) * pps,
    })),
  );
  const splitMarkers = $derived(
    store.splitPoints
      .filter((p) => p > store.inPoint && p < store.outPoint)
      .map((p) => ({ time: p, x: clipLeft + (p - store.inPoint) * pps })),
  );
  const removedBands = $derived(
    store.effectiveCuts
      .map((c) => {
        const start = Math.max(c.start, store.inPoint);
        const end = Math.min(c.end, store.outPoint);
        return {
          id: c.id,
          source: c.source,
          left: clipLeft + (start - store.inPoint) * pps,
          width: Math.max(2, (end - start) * pps),
          valid: end > start,
        };
      })
      .filter((b) => b.valid),
  );
  const inHandleLeft = $derived(clipLeft);
  const outHandleLeft = $derived(clipLeft + clipWidth);

  // Ripple-delete the clip block spanning [start, end]: its midpoint is always
  // inside it, so `deleteSegmentAt` targets exactly this segment. Park the
  // playhead on the join so the preview lands on a kept frame.
  function deleteSegment(start: number, end: number) {
    const joinAt = store.deleteSegmentAt((start + end) / 2);
    if (joinAt === null) return;
    store.currentTime = joinAt;
    if (videoEl) videoEl.currentTime = joinAt;
  }

  let activeTrimHandle = $state<"in" | "out" | null>(null);

  // Live drag context for the in/out trim handles. `originalAt` is the value
  // the handle had at pointer-down — used to display a delta in the tooltip
  // so users see exactly how many frames they've shaved off.
  let trimDragContext = $state<{
    which: "in" | "out";
    originalAt: number;
  } | null>(null);

  function startTrimDrag(event: PointerEvent, which: "in" | "out") {
    if (duration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    // Single undo entry per drag, regardless of how many pointermove events
    // fire while the user holds the handle.
    store.pushUndoState();
    activeTrimHandle = which;
    trimDragContext = {
      which,
      originalAt: which === "in" ? store.inPoint : store.outPoint,
    };
    document.body.style.cursor = "ew-resize";
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    updateTrimFromPointer(event.clientX, which, true);
    const onMove = (e: PointerEvent) => {
      updateTrimFromPointer(e.clientX, which, true);
    };
    const onUp = (e: PointerEvent) => {
      activeTrimHandle = null;
      trimDragContext = null;
      document.body.style.cursor = "";
      try {
        (event.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // already released on some browsers
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function updateTrimFromPointer(
    clientX: number,
    which: "in" | "out",
    scrub = false,
  ) {
    const raw = clientXToTime(clientX);
    const t = quantizeToFrame(raw, fps);
    const min = minClipDuration(fps);
    if (which === "in") {
      const next = Math.max(0, Math.min(t, store.outPoint - min));
      store.trimStart = next;
      // Scrub-while-trim: park playback at the in point so the preview
      // shows the first kept frame as the user drags.
      if (scrub) {
        store.currentTime = next;
        if (videoEl) videoEl.currentTime = next;
      }
    } else {
      const next = Math.min(duration, Math.max(t, store.inPoint + min));
      store.trimEnd = next;
      if (scrub) {
        // Show one frame before the cut (the last kept frame) — that's the
        // frame the user is actually deciding to keep or discard.
        const previewAt = Math.max(store.inPoint, next - frameStep(fps));
        store.currentTime = previewAt;
        if (videoEl) videoEl.currentTime = previewAt;
      }
    }
  }

  function nudgeTrimByKey(which: "in" | "out", direction: 1 | -1, second: boolean) {
    if (duration <= 0) return;
    store.pushUndoStateCoalesced(`trim-${which}`, 500);
    const delta = direction * (second ? 1 : frameStep(fps));
    const min = minClipDuration(fps);
    if (which === "in") {
      const next = quantizeToFrame(
        Math.max(0, Math.min(store.outPoint - min, store.inPoint + delta)),
        fps,
      );
      store.trimStart = next;
    } else {
      const next = quantizeToFrame(
        Math.max(store.inPoint + min, Math.min(duration, store.outPoint + delta)),
        fps,
      );
      store.trimEnd = next;
    }
  }

  function handleTrimHandleKey(event: KeyboardEvent, which: "in" | "out") {
    if (duration <= 0) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    nudgeTrimByKey(which, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
  }
</script>

<div class="relative h-12">
  <!-- One block per kept segment. Splitting divides the clip into two adjacent
       blocks; deleting a block ripple-closes the gap. Each block shows its own
       slice of the shared thumbnail strip (shifted via stripOffset). -->
  {#each clipBlocks as block (block.key)}
    {@const selected =
      store.selectedClipStart !== null &&
      Math.abs(store.selectedClipStart - block.start) < 1e-4}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      role="button"
      tabindex="-1"
      onclick={() => (store.selectedClipStart = block.start)}
      class="group/clip absolute inset-y-0 cursor-pointer overflow-hidden rounded-md border bg-primary/5 transition-[box-shadow,border-color] {selected
        ? 'border-primary ring-2 ring-primary/50'
        : 'border-primary/40 hover:border-primary/70'}"
      style="left: {block.left}px; width: {block.width}px;"
    >
      {#if store.thumbnailStrip.length > 0}
        <div
          class="flex h-full"
          style="width: {clipWidth}px; margin-left: {block.stripOffset}px;"
        >
          {#each store.thumbnailStrip as frame, index (frame + index)}
            <img
              in:fade={{ duration: 180 }}
              src={frame}
              alt="Timeline frame"
              class="h-full shrink-0 object-cover"
              style="width: {thumbnailWidth}px;"
              draggable="false"
            />
          {/each}
        </div>
      {:else}
        <div
          class="flex h-full items-center justify-center text-[10px] text-muted-foreground"
        >
          Generating thumbnails…
        </div>
      {/if}

      <!-- Per-clip ripple delete (only when there's more than one clip — the
           trim handles, not this, remove the whole recording). Ripple-delete is
           part of the opt-in timeline-editing feature, so the affordance is
           hidden unless that's enabled (a silence-only split could otherwise
           expose it). -->
      {#if clipBlocks.length > 1 && experimentalStore.timelineEditing}
        <!-- svelte-ignore a11y_consider_explicit_label -->
        <button
          type="button"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => deleteSegment(block.start, block.end)}
          title="Delete this clip and close the gap"
          class="absolute right-1 top-1 z-7 flex size-4 items-center justify-center rounded bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover/clip:opacity-100"
        >
          <Trash2 class="size-2.5" />
        </button>
      {/if}
    </div>
  {/each}

  <!-- Removed sections (ripple-deleted / cut ranges). Click to restore. -->
  {#each removedBands as band (band.id)}
    {@const isSilence = band.source === "silence"}
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <!-- Deleted clips (manual) read as a SOLID block; auto-detected silence as a
         diagonal hatch — so the two kinds of removal are visually distinct. -->
    <button
      type="button"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => store.removeCut(band.id)}
      title={isSilence
        ? "Silence (auto-detected) — click to restore"
        : "Deleted clip — click to restore"}
      class="absolute inset-y-0 z-5 rounded-sm border border-destructive/60 bg-destructive/25"
      style="left: {band.left}px; width: {band.width}px;{isSilence
        ? ' background-image: repeating-linear-gradient(45deg, transparent, transparent 5px, color-mix(in srgb, var(--destructive) 28%, transparent) 5px, color-mix(in srgb, var(--destructive) 28%, transparent) 10px);'
        : ''}"
    ></button>
  {/each}

  <!-- Split seams between adjacent clips. Double-click to rejoin. -->
  {#each splitMarkers as marker (marker.time)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="presentation"
      onpointerdown={(e) => e.stopPropagation()}
      ondblclick={() => store.removeSplit(marker.time)}
      title="Split — double-click to rejoin"
      class="group/split absolute inset-y-0 z-6 w-2 -translate-x-1/2 cursor-pointer"
      style="left: {marker.x}px;"
    >
      <div
        class="mx-auto h-full w-px bg-warning transition-all group-hover/split:w-0.5"
      ></div>
    </div>
  {/each}

  <!--
    Trim drag handles, anchored to the in/out points. Each is a narrow vertical
    bar with a larger invisible hit area so grabbing is easy. Pointer events
    stop propagation so we don't fight the timeline's click-to-seek scrub.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="slider"
    tabindex="0"
    aria-label="In point"
    aria-valuemin={0}
    aria-valuemax={duration}
    aria-valuenow={store.inPoint}
    aria-valuetext={formatTimecode(store.inPoint, fps)}
    onpointerdown={(e) => startTrimDrag(e, "in")}
    onkeydown={(e) => handleTrimHandleKey(e, "in")}
    class="group absolute inset-y-0 z-10 w-2 -translate-x-1 cursor-ew-resize focus-visible:outline-none"
    style="left: {inHandleLeft}px;"
  >
    <div
      class="mx-auto h-full w-1 rounded-l-md bg-primary transition-all group-hover:w-1.5 group-hover:ring-2 group-hover:ring-primary/30"
    ></div>
    {#if activeTrimHandle === "in" && trimDragContext}
      {@const delta = store.inPoint - trimDragContext.originalAt}
      <div
        class="pointer-events-none absolute bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 font-mono text-[9px] text-foreground shadow-sm"
      >
        <span>In {formatTimeByMode(store.inPoint, timeMode, fps)}</span>
        {#if delta !== 0}
          <span class="text-muted-foreground"
            >{delta > 0 ? "+" : ""}{Math.round(delta * fps)} f</span
          >
        {/if}
      </div>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="slider"
    tabindex="0"
    aria-label="Out point"
    aria-valuemin={0}
    aria-valuemax={duration}
    aria-valuenow={store.outPoint}
    aria-valuetext={formatTimecode(store.outPoint, fps)}
    onpointerdown={(e) => startTrimDrag(e, "out")}
    onkeydown={(e) => handleTrimHandleKey(e, "out")}
    class="group absolute inset-y-0 z-10 w-2 -translate-x-1 cursor-ew-resize focus-visible:outline-none"
    style="left: {outHandleLeft}px;"
  >
    <div
      class="mx-auto h-full w-1 rounded-r-md bg-primary transition-all group-hover:w-1.5 group-hover:ring-2 group-hover:ring-primary/30"
    ></div>
    {#if activeTrimHandle === "out" && trimDragContext}
      {@const delta = store.outPoint - trimDragContext.originalAt}
      <div
        class="pointer-events-none absolute bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 font-mono text-[9px] text-foreground shadow-sm"
      >
        <span>Out {formatTimeByMode(store.outPoint, timeMode, fps)}</span>
        {#if delta !== 0}
          <span class="text-muted-foreground"
            >{delta > 0 ? "+" : ""}{Math.round(delta * fps)} f</span
          >
        {/if}
      </div>
    {/if}
  </div>
</div>
