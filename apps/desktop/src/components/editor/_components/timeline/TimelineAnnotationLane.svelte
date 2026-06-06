<script lang="ts">
  import type { Annotation, EditorStore } from "$lib/stores/editor-store.svelte";
  import type { TimeMode } from "./timeline-helpers";
  import { buildSnapTargets, snapLabel, type SnapTarget } from "./timeline-snap";
  import AnnotationLayerCard from "./AnnotationLayerCard.svelte";

  // Annotation lane — sister of TimelineZoomLane. Same lifted-state pattern
  // for the snap guide so visual feedback during a drag is consistent
  // between lanes.

  interface Props {
    store: EditorStore;
    pixelsPerSecond: number;
    fps: number;
    duration: number;
    timeMode: TimeMode;
    onDuplicate: (annotation: Annotation) => void;
  }

  let {
    store,
    pixelsPerSecond,
    fps,
    duration,
    timeMode,
    onDuplicate,
  }: Props = $props();

  let activeSnap = $state<SnapTarget | null>(null);

  function targetsFor(excludeId: string): SnapTarget[] {
    return buildSnapTargets({
      playhead: store.currentTime,
      inPoint: store.inPoint,
      outPoint: store.outPoint,
      duration,
      regions: store.zoomRegions,
      annotations: store.annotations,
      excludeAnnotationId: excludeId,
    });
  }
</script>

<div
  class="relative mt-1.5 min-h-9 rounded-md border border-border/60 bg-background/40 px-1.5 py-1.5 transition-opacity"
  class:opacity-50={store.annotationsGloballyHidden}
>
  {#if store.annotations.length === 0}
    <div
      class="flex h-6 items-center justify-center text-[10px] text-muted-foreground"
    >
      Annotations you draw on the preview appear here as draggable layers
    </div>
  {:else}
    {#each store.annotations as annotation, index (annotation.id)}
      <AnnotationLayerCard
        {store}
        {annotation}
        {index}
        {pixelsPerSecond}
        {fps}
        {duration}
        snapTargets={targetsFor(annotation.id)}
        {timeMode}
        onSnapChange={(snap) => (activeSnap = snap)}
        {onDuplicate}
      />
    {/each}
  {/if}

  {#if activeSnap}
    <div
      class="pointer-events-none absolute -top-25 z-40 h-50 w-px bg-warning/80"
      style="left: {activeSnap.time * pixelsPerSecond + 6}px;"
    ></div>
    <div
      class="pointer-events-none absolute -top-25 z-40 -translate-x-1/2 rounded border border-warning/60 bg-warning px-1 py-0.5 font-mono text-[9px] text-warning-foreground shadow-craft-sm"
      style="left: {activeSnap.time * pixelsPerSecond + 6}px;"
    >
      {snapLabel(activeSnap.kind)}
    </div>
  {/if}
</div>
