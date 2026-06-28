<script lang="ts">
  import InspectorHint from "$components/editor/InspectorHint.svelte";
  import { experimentalStore } from "$lib/stores/experimental.svelte";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import {
    Clock,
    Gauge,
    Keyboard,
    Maximize2,
    RotateCcw,
    Scissors,
    Search,
    SlidersHorizontal,
    SquareSplitHorizontal,
    Target,
    VolumeX,
    Wand2,
    ZoomIn,
    ZoomOut,
  } from "@lucide/svelte";
  import * as DropdownMenu from "@recast/ui/dropdown-menu";
  import { Kbd } from "@recast/ui/kbd";
  import * as Popover from "@recast/ui/popover";
  import { SliderControl } from "@recast/ui/slider-control";
  import { cn } from "@recast/ui/utils";
  import SilenceReviewPopover from "../../SilenceReviewPopover.svelte";
  import ZoomSuggestionsPopover from "../../ZoomSuggestionsPopover.svelte";
  import { formatTimeByMode, type TimeMode } from "./timeline-helpers";

  // Popovers (Suggest, Remove-silence, Speed) must be portalled: the timeline
  // sits in an `overflow-hidden` slide wrapper that would clip an in-DOM popover.

  interface Props {
    store: EditorStore;
    fps: number;
    hasTrim: boolean;
    aspectRatioLabel: string;
    frameCount: number;
    playbackSpeed: number;
    speeds: readonly number[];
    timeMode: TimeMode;
    hasSelectedRegion: boolean;
    onSetTrim: (kind: "in" | "out") => void;
    onSplit: () => void;
    onAddFocusRegion: () => void;
    onResetTrim: () => void;
    onZoomTimeline: (dir: number) => void;
    onSelectSpeed: (speed: number) => void;
    onSetTimeMode: (mode: TimeMode) => void;
    onZoomToFit: () => void;
    onZoomToSelection: () => void;
  }

  let {
    store,
    fps,
    hasTrim,
    aspectRatioLabel,
    frameCount,
    playbackSpeed,
    speeds,
    timeMode,
    hasSelectedRegion,
    onSetTrim,
    onSplit,
    onAddFocusRegion,
    onResetTrim,
    onZoomTimeline,
    onSelectSpeed,
    onSetTimeMode,
    onZoomToFit,
    onZoomToSelection,
  }: Props = $props();

  const trimHint = `Set trim points to exclude parts of the clip from export, or add focus regions to highlight important moments. You can also ask Trace to suggest focus regions based on where you moved the cursor.`;

  let suggestOpen = $state(false);
  let showSilence = $state(false);

  // Counts only silence-detected cuts; manual ripple deletes shouldn't inflate this.
  const silenceCutCount = $derived(
    store.cuts.filter((c) => c.source === "silence").length,
  );

  // Shared control styling so every toolbar affordance reads the same.
  const GROUP =
    "flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 ring-1 ring-inset ring-border/40";
  const SEG =
    "flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground disabled:opacity-40";
  const SEG_ICON =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground disabled:opacity-40";
  const SEG_ACTIVE =
    "bg-card text-foreground shadow-(--shadow-craft-inset) ring-1 ring-inset ring-border/40";
  const SOLO =
    "flex h-6 items-center gap-1 rounded-md border border-border/40 bg-muted/40 px-2 text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground disabled:opacity-40";

  const speedLabel = (s: number) => `${s.toFixed(2).replace(/\.?0+$/, "")}×`;

  const SPEED_MIN = 0.25;
  const SPEED_MAX = 2;
</script>

<div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
  <div class="flex items-center gap-1">
    <InspectorHint content={trimHint} />

    <div class={GROUP}>
      <button
        type="button"
        onclick={() => onSetTrim("in")}
        title="Cut everything before the playhead (I)"
        class={SEG}
      >
        <span class="hidden sm:inline">Start here</span>
        <span class="sm:hidden">Start</span>
        <Kbd class="ml-0.5">I</Kbd>
      </button>
      <button
        type="button"
        onclick={() => onSetTrim("out")}
        title="Cut everything after the playhead (O)"
        class={SEG}
      >
        <span class="hidden sm:inline">End here</span>
        <span class="sm:hidden">End</span>
        <Kbd class="ml-0.5">O</Kbd>
      </button>
    </div>

    <button
      type="button"
      onclick={onSplit}
      title="Split the clip at the playhead (S)"
      class={SOLO}
    >
      <SquareSplitHorizontal class="size-3" />
      <span class="hidden sm:inline">Split</span>
      <Kbd class="ml-0.5">S</Kbd>
    </button>

    <div class={GROUP}>
      <button type="button" onclick={onAddFocusRegion} class={SEG}>
        <Search class="size-3" />
        Focus
      </button>
      <Popover.Root open={suggestOpen} onOpenChange={(v) => (suggestOpen = v)}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              disabled={!store.cursorPath}
              title={store.cursorPath
                ? "Suggest focus regions from captured cursor activity"
                : "No cursor data in this clip"}
              class={cn(SEG, suggestOpen && SEG_ACTIVE)}
            >
              <Wand2 class="size-3" />
              Suggest
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content
          side="top"
          align="start"
          class="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
        >
          <ZoomSuggestionsPopover {store} onclose={() => (suggestOpen = false)} />
        </Popover.Content>
      </Popover.Root>
    </div>

    <!-- Gated behind the experimental flag (Settings → Experimental) — in-progress UI. -->
    {#if experimentalStore.silenceDetection}
      <Popover.Root open={showSilence} onOpenChange={(v) => (showSilence = v)}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              disabled={!store.audioPath && !store.microphonePath}
              title={store.audioPath || store.microphonePath
                ? "Find and remove silent gaps in this recording"
                : "This clip has no audio track to analyse"}
              class={cn(SOLO, showSilence && SEG_ACTIVE)}
            >
              <VolumeX class="size-3" />
              Remove silence
              {#if silenceCutCount > 0}
                <span
                  class="rounded bg-primary/15 px-1 text-[9px] font-bold text-primary"
                >
                  {silenceCutCount}
                </span>
              {/if}
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content
          side="top"
          align="start"
          class="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
        >
          <SilenceReviewPopover {store} onclose={() => (showSilence = false)} />
        </Popover.Content>
      </Popover.Root>
    {/if}

    {#if hasTrim}
      <button
        type="button"
        onclick={onResetTrim}
        title="Restore the full recording — undo all cuts"
        class={SOLO}
      >
        <Scissors class="size-3" />
        Use full clip
      </button>
    {/if}

    <!-- Inline discoverability for the core clip keys; hidden on narrow rails. -->
    <span
      class="ml-1 hidden items-center gap-1 text-[10px] text-muted-foreground xl:inline-flex"
    >
      <Kbd>S</Kbd>
      split
      <Kbd>⌫</Kbd>
      remove
    </span>
  </div>

  <div class="flex items-center gap-1.5 text-muted-foreground">
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" aria-label="Playback speed" class={SOLO}>
            <Gauge class="size-3" />
            <span class="font-mono tabular-nums">{speedLabel(playbackSpeed)}</span>
          </button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content side="top" align="end" class="w-56">
        <div class="flex flex-col gap-2.5">
          <SliderControl
            label="Playback speed"
            value={playbackSpeed}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.05}
            unit="×"
            formatValue={(v) => speedLabel(v)}
            onchange={(v) => onSelectSpeed(v)}
          >
            {#snippet icon()}
              <Gauge class="size-3" />
            {/snippet}
          </SliderControl>
          <div class="flex items-center gap-1">
            {#each speeds as speed (speed)}
              {@const active = Math.abs(playbackSpeed - speed) < 0.001}
              <button
                type="button"
                onclick={() => onSelectSpeed(speed)}
                aria-pressed={active}
                class={cn(
                  "flex-1 rounded-md border px-1.5 py-1 font-mono text-[10px] font-semibold tabular-nums transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {speedLabel(speed)}
              </button>
            {/each}
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>

    <div class={GROUP}>
      <button
        type="button"
        onclick={() => onZoomTimeline(-1)}
        aria-label="Zoom out timeline"
        class={SEG_ICON}
      >
        <ZoomOut class="size-3" />
      </button>
      <span
        class="min-w-9 text-center font-mono text-[10px] font-semibold tabular-nums text-foreground"
      >
        {store.timelineZoom.toFixed(1)}×
      </span>
      <button
        type="button"
        onclick={() => onZoomTimeline(1)}
        aria-label="Zoom in timeline"
        class={SEG_ICON}
      >
        <ZoomIn class="size-3" />
      </button>
      <button
        type="button"
        onclick={onZoomToFit}
        aria-label="Zoom to fit"
        title="Fit the entire clip in view"
        class={SEG_ICON}
      >
        <Maximize2 class="size-3" />
      </button>
      <button
        type="button"
        onclick={onZoomToSelection}
        disabled={!hasSelectedRegion}
        aria-label="Zoom to selection"
        title={hasSelectedRegion
          ? "Zoom in on the selected focus region"
          : "Select a focus region first"}
        class={SEG_ICON}
      >
        <Target class="size-3" />
      </button>
    </div>

    {#if hasTrim}
      <span
        class="inline-flex h-6 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 font-mono text-[10px] font-semibold tabular-nums text-primary"
        title="Length of the kept clip"
      >
        <Scissors class="size-2.5" />
        {formatTimeByMode(store.clipDuration, timeMode, fps)}
      </span>
    {/if}

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" aria-label="View options" class={SOLO}>
          <SlidersHorizontal class="size-3" />
          <span class="hidden md:inline">View</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="sm" align="end" class="w-52">
        <DropdownMenu.Label class="flex items-center gap-1.5">
          <Clock class="size-3" />
          Time display
        </DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={timeMode}
          onValueChange={(v) => onSetTimeMode(v as TimeMode)}
        >
          <DropdownMenu.RadioItem value="smpte">Timecode</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="seconds">Seconds</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="frames">Frames</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>

        <DropdownMenu.Separator />

        <DropdownMenu.Label
          class="flex items-center justify-between font-normal text-muted-foreground"
        >
          Aspect ratio
          <span class="font-mono tabular-nums text-foreground">
            {aspectRatioLabel}
          </span>
        </DropdownMenu.Label>
        <DropdownMenu.Label
          class="flex items-center justify-between font-normal text-muted-foreground"
        >
          Frames
          <span class="font-mono tabular-nums text-foreground">
            {frameCount}f
          </span>
        </DropdownMenu.Label>

        <DropdownMenu.Separator />

        <DropdownMenu.Label class="flex items-center gap-1.5">
          <Keyboard class="size-3" />
          Shortcuts
        </DropdownMenu.Label>
        <DropdownMenu.Label
          class="flex items-center justify-between font-normal text-muted-foreground"
        >
          Pan
          <Kbd>Scroll</Kbd>
        </DropdownMenu.Label>
        <DropdownMenu.Label
          class="flex items-center justify-between font-normal text-muted-foreground"
        >
          Zoom
          <Kbd>⌘ Scroll</Kbd>
        </DropdownMenu.Label>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>
