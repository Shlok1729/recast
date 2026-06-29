<script lang="ts">
  import { formatTimeByMode, type TimeMode } from "./timeline-helpers";

  // While dragging, the [left] transition is suppressed so the head pins under the cursor.

  interface Props {
    currentTime: number;
    /** px on the output (post-cut) axis. The label still shows `currentTime`
     *  (original time); only the position is output-mapped. */
    leftPx: number;
    fps: number;
    isDragging: boolean;
    timeMode: TimeMode;
  }

  let { currentTime, leftPx, fps, isDragging, timeMode }: Props = $props();

  const playheadLeft = $derived(leftPx);
</script>

<!-- Spans the full track height via inset-y-0 so it tracks however many lanes are
     shown; the guide line flexes to fill below the head. -->
<div
  class="absolute inset-y-0 z-30 transition-[left] ease-out"
  style="left: {playheadLeft}px; transition-duration: {isDragging
    ? '0ms'
    : '90ms'};"
>
  <div class="relative flex h-full flex-col -translate-x-1/2">
    <div
      class="absolute left-1/2 top-1 -translate-x-1/2 rounded border border-border bg-foreground px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-background shadow-craft-sm"
    >
      {formatTimeByMode(currentTime, timeMode, fps)}
    </div>
    <div
      class="mx-auto mt-6 size-2 shrink-0 rounded-full border border-background bg-primary ring-1 ring-primary/30"
    ></div>
    <div
      class="mx-auto w-px flex-1 bg-primary/70 pointer-events-none"
      id="timeline-control"
    ></div>
  </div>
</div>
