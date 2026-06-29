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
    /** When false (cut lane hidden), the guide line stops at the annotation lane. */
    tall?: boolean;
  }

  let {
    currentTime,
    leftPx,
    fps,
    isDragging,
    timeMode,
    tall = true,
  }: Props = $props();

  const playheadLeft = $derived(leftPx);
</script>

<div
  class="absolute top-0 z-30 transition-[left] ease-out"
  style="left: {playheadLeft}px; transition-duration: {isDragging
    ? '0ms'
    : '90ms'};"
>
  <div class="relative -translate-x-1/2">
    <div
      class="absolute left-1/2 top-1 -translate-x-1/2 rounded border border-border bg-foreground px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-background shadow-craft-sm"
    >
      {formatTimeByMode(currentTime, timeMode, fps)}
    </div>
    <div
      class="mx-auto mt-6 size-2 rounded-full border border-background bg-primary ring-1 ring-primary/30"
    ></div>
    <div
      class="mx-auto w-px bg-primary/70 pointer-events-none"
      class:h-57={tall}
      class:h-45={!tall}
      id="timeline-control"
    ></div>
  </div>
</div>
