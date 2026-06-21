<script lang="ts">
  import { formatTimeByMode, type TimeMode } from "./timeline-helpers";

  // Vertical playhead column with timecode pill on top and a thin guide line
  // running the height of the timeline. While the user actively drags, the
  // [left] transition is suppressed so the head pins under the cursor.

  interface Props {
    currentTime: number;
    /** Horizontal position in px, already mapped onto the output (post-cut)
     *  axis by the parent. The label still shows `currentTime` (original time,
     *  what the rest of the app uses); only the position is output-mapped. */
    leftPx: number;
    fps: number;
    isDragging: boolean;
    timeMode: TimeMode;
    /** When false (cut lane hidden), the playhead guide line is shortened
     *  so it stops at the bottom of the annotation lane instead of dangling
     *  into empty space. */
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
      class="absolute left-1/2 top-1 -translate-x-1/2 rounded border border-border bg-foreground px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-background"
    >
      {formatTimeByMode(currentTime, timeMode, fps)}
    </div>
    <div
      class="mx-auto mt-6 size-2 rounded-full border border-background bg-primary"
    ></div>
    <div
      class="mx-auto w-px bg-primary/60 pointer-events-none"
      class:h-57={tall}
      class:h-45={!tall}
      id="timeline-control"
    ></div>
  </div>
</div>
