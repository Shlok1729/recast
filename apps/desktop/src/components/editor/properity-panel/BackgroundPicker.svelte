<script lang="ts">
  import LazyExternalImage from "$components/common/LazyExternalImage.svelte";
  import {
    COLOR_PRESETS,
    DEFAULT_GRADIENT,
    GRADIENT_PRESETS,
    MAX_FRAME_PADDING_PERCENT,
    MAX_GRADIENT_STOPS,
    parseGradient,
    serializeGradient,
    WALLPAPERS,
    wallpaperBackgroundValue,
    type BackgroundType,
    type EditorStore,
    type GradientSpec,
  } from "$lib/stores/editor-store.svelte";
  import {
    Blend,
    FolderOpen,
    ImageIcon,
    LayoutTemplate,
    Move,
    Palette,
    Plus,
    RotateCw,
    Sparkles,
    SquareRoundCorner,
    Trash2,
  } from "@lucide/svelte";
  import {
    getRecentColors,
    pushRecentColor,
  } from "$lib/annotations/recent-colors";
  import { registry } from "$lib/registry";
  import { Button } from "@recast/ui/button";
  import { ColorField } from "@recast/ui/color-field";
  import { SegmentedToggle } from "@recast/ui/segmented";
  import * as Tabs from "@recast/ui/tabs";
  import { cn } from "@recast/ui/utils";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { Image } from "@unpic/svelte";
  import { SliderControl } from "@recast/ui/slider-control";
  import PanelSection from "./PanelSection.svelte";

  interface Props {
    store: EditorStore;
  }

  type BackgroundMode = {
    type: BackgroundType;
    label: string;
    icon: typeof Sparkles;
  };

  const backgroundModes: BackgroundMode[] = [
    { type: "wallpaper", label: "Wallpaper", icon: Sparkles },
    { type: "color", label: "Color", icon: Palette },
    { type: "gradient", label: "Gradient", icon: Blend },
    { type: "image", label: "Image", icon: ImageIcon },
  ];

  const DEFAULT_BACKGROUND_VALUES: Record<BackgroundType, string> = {
    wallpaper: WALLPAPERS[0] ? wallpaperBackgroundValue(WALLPAPERS[0].id) : "",
    color: COLOR_PRESETS[0] ?? "#000000",
    gradient:
      GRADIENT_PRESETS[0]?.value ??
      "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
    image: "",
  };

  let { store }: Props = $props();

  let recents = $state<string[]>(getRecentColors());
  function rememberColor(color: string) {
    recents = pushRecentColor(color);
  }

  // ── Custom gradient builder ────────────────────────────────────────────
  // The draft is the editing source of truth; it serialises to the same CSS
  // string the store holds and both renderers (WebGL preview + Rust export)
  // parse. We keep a local draft so dragging a stop doesn't round-trip
  // through the store on every pointer-move, then stream it back via
  // `setBackgroundLive` (coalesced undo) for a live preview.
  let gradientDraft = $state<GradientSpec>(
    parseGradient(
      store.backgroundType === "gradient" ? store.backgroundValue : DEFAULT_GRADIENT,
    ),
  );
  let selectedStop = $state(0);
  let gradientBarEl = $state<HTMLDivElement | null>(null);

  // Reconcile the draft when the store's gradient changes from the outside
  // (undo/redo, a preset click). Guard with a serialise-compare so our own
  // live edits don't bounce back and fight the drag.
  $effect(() => {
    if (store.backgroundType !== "gradient") return;
    const current = store.backgroundValue;
    if (current !== serializeGradient(gradientDraft)) {
      gradientDraft = parseGradient(current);
      if (selectedStop >= gradientDraft.stops.length) selectedStop = 0;
    }
  });

  const gradientCss = $derived(serializeGradient(gradientDraft));

  // Live commit (drag gestures) → single coalesced undo entry. Discrete edits
  // (add/remove stop) pass `live=false` for a clean, individually-undoable step.
  function commitGradient(next: GradientSpec, live = true) {
    gradientDraft = next;
    const value = serializeGradient(next);
    if (live) store.setBackgroundLive("gradient", value);
    else store.setBackground({ type: "gradient", value });
  }

  function setStopColor(i: number, color: string) {
    commitGradient({
      ...gradientDraft,
      stops: gradientDraft.stops.map((s, j) => (j === i ? { ...s, color } : s)),
    });
  }

  function setStopPos(i: number, pos: number) {
    const clamped = Math.round(Math.min(100, Math.max(0, pos)));
    commitGradient({
      ...gradientDraft,
      stops: gradientDraft.stops.map((s, j) => (j === i ? { ...s, pos: clamped } : s)),
    });
  }

  function setAngle(angle: number) {
    commitGradient({ ...gradientDraft, angle });
  }

  // Sample the draft at a position (0..100) to seed a new stop's color —
  // mirrors the renderer's sRGB lerp so the inserted stop is visually neutral.
  function sampleDraftColor(pos: number): string {
    const stops = [...gradientDraft.stops].sort((a, b) => a.pos - b.pos);
    if (pos <= stops[0].pos) return stops[0].color;
    const last = stops[stops.length - 1];
    if (pos >= last.pos) return last.color;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (pos >= a.pos && pos <= b.pos) {
        const f = (pos - a.pos) / Math.max(b.pos - a.pos, 1e-6);
        return lerpHex(a.color, b.color, f);
      }
    }
    return last.color;
  }

  function lerpHex(c0: string, c1: string, f: number): string {
    const p = (h: string) => {
      const s = h.replace("#", "");
      return [
        parseInt(s.slice(0, 2), 16),
        parseInt(s.slice(2, 4), 16),
        parseInt(s.slice(4, 6), 16),
      ];
    };
    const [r0, g0, b0] = p(c0);
    const [r1, g1, b1] = p(c1);
    const mix = (a: number, b: number) =>
      Math.round(a + (b - a) * f)
        .toString(16)
        .padStart(2, "0");
    return `#${mix(r0, r1)}${mix(g0, g1)}${mix(b0, b1)}`;
  }

  function addStop() {
    if (gradientDraft.stops.length >= MAX_GRADIENT_STOPS) return;
    // Insert in the widest gap so the new handle lands somewhere useful.
    const sorted = [...gradientDraft.stops].sort((a, b) => a.pos - b.pos);
    let gapPos = 50;
    let widest = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].pos - sorted[i].pos;
      if (gap > widest) {
        widest = gap;
        gapPos = Math.round((sorted[i].pos + sorted[i + 1].pos) / 2);
      }
    }
    const stops = [
      ...gradientDraft.stops,
      { color: sampleDraftColor(gapPos), pos: gapPos },
    ];
    commitGradient({ ...gradientDraft, stops }, false);
    selectedStop = stops.length - 1;
  }

  function removeStop(i: number) {
    if (gradientDraft.stops.length <= 2) return;
    const stops = gradientDraft.stops.filter((_, j) => j !== i);
    commitGradient({ ...gradientDraft, stops }, false);
    selectedStop = Math.min(selectedStop, stops.length - 1);
  }

  // Drag a stop handle along the bar. Streams position live; the whole drag
  // coalesces to one undo entry via `setBackgroundLive`.
  function startStopDrag(e: PointerEvent, i: number) {
    e.preventDefault();
    selectedStop = i;
    const bar = gradientBarEl;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      setStopPos(i, ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * 100);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Double-click an empty spot on the bar to drop a new stop there.
  function addStopAtPointer(e: MouseEvent) {
    if (gradientDraft.stops.length >= MAX_GRADIENT_STOPS) return;
    const bar = gradientBarEl;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pos = Math.round(
      Math.min(100, Math.max(0, ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 100)),
    );
    const stops = [...gradientDraft.stops, { color: sampleDraftColor(pos), pos }];
    commitGradient({ ...gradientDraft, stops }, false);
    selectedStop = stops.length - 1;
  }

  // Mode tabs (Wallpaper/Color/Gradient/Image) drive which preset list is
  // shown — they do NOT mutate the actual background. The store is only
  // updated when the user explicitly picks a preset. This keeps a user's
  // applied background intact while they browse other modes, and prevents
  // a tab-switch from silently replacing it with the first preset.
  let displayedMode = $state<BackgroundType>(store.backgroundType);
  $effect(() => {
    displayedMode = store.backgroundType;
  });

  let blurValue = $state(0);
  let paddingValue = $state(0);
  let borderRadiusValue = $state(0);

  function isValidValueForType(type: BackgroundType, value: string) {
    switch (type) {
      case "wallpaper":
        // Any registered background id (built-in `asset:<id>` or an `ext:` pack).
        return registry.get("background", value) !== undefined;
      case "color":
        return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
      case "gradient":
        return value.includes("gradient(");
      case "image":
        return value.length > 0;
      default:
        return false;
    }
  }

  function isValidImageValue(value: string) {
    if (!value) return false;
    // Explicitly reject non-image values that might linger in
    // `backgroundValue` after switching tabs (gradient strings, colour
    // hex, internal asset ids). Without this guard these slip through to
    // the `<Image>` element below, which feeds them into convertFileSrc
    // and triggers a Tauri asset-protocol "file does not exist" error.
    if (
      value.includes("gradient(") ||
      value.startsWith("#") ||
      value.startsWith("asset:")
    ) {
      return false;
    }
    return (
      value.startsWith("data:") ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("asset://") ||
      value.startsWith("/wallpapers/") ||
      value.endsWith(".png") ||
      value.endsWith(".jpg") ||
      value.endsWith(".jpeg") ||
      value.endsWith(".webp")
    );
  }

  function getSelectionValue(type: BackgroundType) {
    return isValidValueForType(type, store.backgroundValue)
      ? store.backgroundValue
      : DEFAULT_BACKGROUND_VALUES[type];
  }

  function applyBackground(
    type: BackgroundType,
    value = getSelectionValue(type),
  ) {
    // When the user clicks the "Image" tab and there is no valid image yet,
    // jump straight into the file picker instead of setting an empty value
    // (which would leave the preview showing the fallback dark background).
    if (type === "image" && !value) {
      void pickBackgroundImage();
      return;
    }
    store.setBackground({ type, value });
  }

  async function pickBackgroundImage() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Choose Background Image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!selected || typeof selected !== "string") return;
    store.setBackground({ type: "image", value: selected });
  }

  function getImagePreviewSrc(value: string) {
    if (!value) return "";
    // Mirror isValidImageValue's rejections — feeding a gradient string or
    // colour hex to convertFileSrc reaches Tauri's asset protocol and
    // produces "File does not exist" log spam.
    if (
      value.includes("gradient(") ||
      value.startsWith("#") ||
      value.startsWith("asset:")
    ) {
      return "";
    }
    if (
      value.startsWith("data:") ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("asset://") ||
      value.startsWith("/wallpapers/")
    ) {
      return value;
    }
    return convertFileSrc(value);
  }

  $effect(() => {
    blurValue = store.backgroundBlur;
    paddingValue = store.padding;
    borderRadiusValue = store.borderRadius;
  });
</script>

<div class="flex flex-col gap-4 animate-in fade-in duration-200">
  <!-- Reusable blur control. Background blur only affects texture backgrounds
       (image/wallpaper) — the shader leaves color/gradient fills sharp — so it
       lives contextually inside those two modes instead of as a global knob
       that does nothing two-thirds of the time. -->
  {#snippet blurControl()}
    <SliderControl
      label="Background blur"
      bind:value={blurValue}
      min={0}
      max={100}
      step={1}
      unit="%"
      onstart={() => store.pushUndoState()}
      onchange={(next) => {
        store.backgroundBlur = next;
      }}
    >
      {#snippet icon()}
        <Blend size={11} />
      {/snippet}
    </SliderControl>
  {/snippet}

  <!-- Frame + Drop shadow are pinned ABOVE the background browser. They shape
       the video rect regardless of background type and are used often, so they
       stay in a fixed, scroll-free position instead of being pushed down by the
       variable-height background modes (a short Color grid vs. a tall Wallpaper
       grid would otherwise make these controls jump around). -->
  <PanelSection
    title="Frame"
    hint="Padding adds space around the recording; corner radius rounds its edges. Both apply to every background."
  >
    <SliderControl
      label="Frame padding"
      bind:value={paddingValue}
      min={0}
      max={MAX_FRAME_PADDING_PERCENT}
      step={1}
      unit="%"
      onstart={() => store.pushUndoState()}
      onchange={(next) => {
        store.padding = next;
      }}
    >
      {#snippet icon()}
        <LayoutTemplate size={11} />
      {/snippet}
    </SliderControl>

    <SliderControl
      label="Corner radius"
      bind:value={borderRadiusValue}
      min={0}
      max={50}
      step={1}
      unit="%"
      onstart={() => store.pushUndoState()}
      onchange={(next) => {
        store.borderRadius = next;
      }}
    >
      {#snippet icon()}
        <SquareRoundCorner size={11} />
      {/snippet}
    </SliderControl>
  </PanelSection>

  <!-- Drop shadow — collapses to a single toggle row, so it stays compact at
       the top even when off. -->
  <PanelSection
    title="Drop shadow"
    hint="Adds depth by casting a soft shadow under the recording onto the canvas background."
    flush
    collapsible
    defaultOpen={store.shadow.enabled}
  >
    {#snippet action()}
      <SegmentedToggle
        checked={store.shadow.enabled}
        size="xs"
        aria-label="Drop shadow"
        onCheckedChange={(next) => {
          store.pushUndoState();
          store.updateShadow({ enabled: next });
        }}
      />
    {/snippet}

    {#if store.shadow.enabled}
      <div class="space-y-2.5">
        <SliderControl
          label="Blur"
          value={store.shadow.blur}
          min={0}
          max={100}
          step={1}
          unit="px"
          onstart={() => store.pushUndoState()}
          onchange={(v) => store.updateShadow({ blur: v })}
        >
          {#snippet icon()}
            <Blend size={11} />
          {/snippet}
        </SliderControl>

        <SliderControl
          label="Spread"
          value={store.shadow.spread}
          min={0}
          max={50}
          step={1}
          unit="px"
          onstart={() => store.pushUndoState()}
          onchange={(v) => store.updateShadow({ spread: v })}
        >
          {#snippet icon()}
            <SquareRoundCorner size={11} />
          {/snippet}
        </SliderControl>

        <SliderControl
          label="Offset Y"
          value={store.shadow.offsetY}
          min={-40}
          max={40}
          step={1}
          unit="px"
          onstart={() => store.pushUndoState()}
          onchange={(v) => store.updateShadow({ offsetY: v })}
        >
          {#snippet icon()}
            <Move size={11} />
          {/snippet}
        </SliderControl>

        <SliderControl
          label="Opacity"
          value={store.shadow.opacity}
          min={0}
          max={100}
          step={1}
          unit="%"
          onstart={() => store.pushUndoState()}
          onchange={(v) => store.updateShadow({ opacity: v })}
        />

        <ColorField
          label="Shadow color"
          value={store.shadow.color || "#000000"}
          {recents}
          oncommit={(c: string) => {
            store.pushUndoState();
            store.updateShadow({ color: c });
            rememberColor(c);
          }}
        />
      </div>
    {/if}
  </PanelSection>

  <!-- Background mode switcher + per-mode preset lists, built on the shared
       Tabs component (variant="soft") so it matches the outer properties-panel
       tabs and gets the same sliding active-indicator plus content slide/fade.
       Placed LAST: it's the tall, browse-heavy section, so scrolling is
       reserved for it. The active tab is intentionally decoupled from the
       store: switching tabs only changes which preset list is shown — the
       background isn't mutated until a preset is clicked (see `displayedMode`). -->
  <Tabs.Root
    value={displayedMode}
    onValueChange={(v: string) => (displayedMode = v as BackgroundType)}
    class="flex flex-col gap-4"
  >
    <PanelSection
      title="Background"
      hint="What fills the canvas behind your recording. Previewed live."
      flush
    >
      <Tabs.List
        variant="soft"
        class="flex h-auto items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 ring-1 ring-inset ring-border/40"
      >
        {#each backgroundModes as mode}
          {@const Icon = mode.icon}
          <Tabs.Trigger
            value={mode.type}
            title={mode.label}
            class="h-6 flex-1 gap-1 px-2 text-[11px] font-medium"
          >
            <!-- Explicit `size-` class (not the `size` prop): Tabs.Trigger's
                 base style forces unsized SVGs to size-4, so the class both
                 sets the real 11px size (size-2.75) and opts out of that
                 default. -->
            <Icon class="size-2.75" />
            <span class="hidden @[260px]/panel:inline">{mode.label}</span>
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </PanelSection>

  <Tabs.Content value="wallpaper">
    <PanelSection title="Wallpapers" flush>
      {#snippet action()}
        <span class="font-mono text-[10px] tabular-nums text-muted-foreground">
          {registry.list("background").length}
        </span>
      {/snippet}
      <div class="grid grid-cols-3 gap-1.5">
        {#each registry.list("background") as entry (entry.id)}
          {@const isSelected = store.backgroundValue === entry.id}
          <Button
            variant="raw"
            size="raw"
            onclick={() => applyBackground("wallpaper", entry.id)}
            class={cn(
              "group relative aspect-video overflow-hidden rounded-md border transition-all",
              isSelected
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-foreground/30",
            )}
            title={entry.label}
            aria-label="Use {entry.label} background"
            aria-pressed={isSelected}
          >
            {#if entry.thumbUrl}
              <!-- Extension wallpaper: thumbnail already resolved to a WebView URL. -->
              <img
                src={entry.thumbUrl}
                alt={entry.label}
                class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            {:else if entry.thumbAssetId}
              <LazyExternalImage
                assetId={entry.thumbAssetId}
                alt={entry.label}
                tier="thumb"
                class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            {/if}
          </Button>
        {/each}
      </div>

      <div class="mt-2.5">
        {@render blurControl()}
      </div>
    </PanelSection>
  </Tabs.Content>

  <Tabs.Content value="color">
    <PanelSection
      title="Color"
      hint="Solid backgrounds keep attention on the recording itself."
      flush
    >
      <div class="grid grid-cols-6 gap-1.5">
        {#each registry.list("color") as entry (entry.id)}
          {@const color = entry.value.value}
          {@const isSelected = store.backgroundValue === color}
          <Button
            variant="raw"
            size="raw"
            onclick={() => applyBackground("color", color)}
            aria-label="Use color {color}"
            aria-pressed={isSelected}
            class={cn(
              "aspect-square rounded-md border-2 transition-all",
              isSelected
                ? "border-foreground shadow-sm"
                : "border-border/40 hover:border-border",
            )}
            style="background-color: {color}"
          ></Button>
        {/each}
      </div>

      <div class="mt-2">
        <ColorField
          label="Custom"
          value={store.backgroundValue.startsWith("#")
            ? store.backgroundValue
            : DEFAULT_BACKGROUND_VALUES.color}
          {recents}
          oncommit={(c: string) => {
            store.pushUndoState();
            applyBackground("color", c);
            rememberColor(c);
          }}
        />
      </div>
    </PanelSection>
  </Tabs.Content>

  <Tabs.Content value="gradient">
    <PanelSection
      title="Gradients"
      hint="Rich preset backdrops, rendered live in the preview and the export."
      flush
    >
      {#snippet action()}
        <span class="font-mono text-[10px] tabular-nums text-muted-foreground">
          {registry.list("gradient").length}
        </span>
      {/snippet}
      <div class="grid grid-cols-3 gap-1.5">
        {#each registry.list("gradient") as entry (entry.id)}
          {@const value = entry.value.value}
          {@const isSelected = store.backgroundValue === value}
          <Button
            variant="raw"
            size="raw"
            onclick={() => applyBackground("gradient", value)}
            class={cn(
              "group relative h-14 overflow-hidden rounded-md border p-1.5 text-left transition-all",
              isSelected
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-foreground/30",
            )}
            style="background: {value}"
            aria-label="Use {entry.label} gradient"
            aria-pressed={isSelected}
          >
            <div class="flex h-full items-end">
              <span
                class="rounded border border-black/10 bg-black/40 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm"
              >
                {entry.label}
              </span>
            </div>
          </Button>
        {/each}
      </div>
    </PanelSection>

    <!-- Custom gradient builder. The bar is the source of truth: drag a stop
         to move it, double-click empty space to add one, pick the selected
         stop's color below, and set the angle. Edits stream live to the
         preview and coalesce into a single undo step per gesture. -->
    <PanelSection
      title="Custom"
      hint="Drag stops to reposition · double-click the bar to add a stop."
      flush
    >
      {#snippet action()}
        <Button
          variant="ghost"
          size="xs"
          class="h-6 gap-1 px-1.5 text-[10.5px] text-muted-foreground"
          onclick={addStop}
          disabled={gradientDraft.stops.length >= MAX_GRADIENT_STOPS}
        >
          <Plus size={11} />
          Add stop
        </Button>
      {/snippet}

      <div class="flex flex-col gap-2.5">
        <!-- Gradient track + draggable stop handles -->
        <div
          bind:this={gradientBarEl}
          ondblclick={addStopAtPointer}
          role="presentation"
          class="relative h-9 w-full overflow-visible rounded-md border border-border/60 shadow-(--shadow-craft-inset)"
          style="background: {gradientCss}"
        >
          {#each gradientDraft.stops as stop, i (i)}
            <button
              type="button"
              onpointerdown={(e) => startStopDrag(e, i)}
              onclick={() => (selectedStop = i)}
              ondblclick={(e) => e.stopPropagation()}
              class={cn(
                "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 shadow-md transition-transform active:cursor-grabbing",
                i === selectedStop
                  ? "scale-110 border-primary ring-2 ring-primary/40"
                  : "border-white/90 hover:scale-105",
              )}
              style="left: {stop.pos}%; background-color: {stop.color}"
              aria-label="Gradient stop {i + 1} at {Math.round(stop.pos)}%"
              aria-pressed={i === selectedStop}
            ></button>
          {/each}
        </div>

        <!-- Selected stop: color + remove -->
        <div class="flex items-center gap-1.5">
          <div class="min-w-0 flex-1">
            <ColorField
              label="Stop {selectedStop + 1}"
              value={gradientDraft.stops[selectedStop]?.color ?? "#000000"}
              {recents}
              allowAlpha={false}
              oncommit={(c: string) => {
                setStopColor(selectedStop, c);
                rememberColor(c);
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-muted-foreground hover:text-destructive"
            onclick={() => removeStop(selectedStop)}
            disabled={gradientDraft.stops.length <= 2}
            aria-label="Remove selected stop"
          >
            <Trash2 size={13} />
          </Button>
        </div>

        <!-- Selected stop position -->
        <SliderControl
          label="Position"
          value={gradientDraft.stops[selectedStop]?.pos ?? 0}
          min={0}
          max={100}
          step={1}
          unit="%"
          onstart={() => {}}
          onchange={(v) => setStopPos(selectedStop, v)}
        >
          {#snippet icon()}
            <Move size={11} />
          {/snippet}
        </SliderControl>

        <!-- Gradient angle -->
        <SliderControl
          label="Angle"
          value={gradientDraft.angle}
          min={0}
          max={360}
          step={1}
          unit="°"
          onstart={() => {}}
          onchange={(v) => setAngle(v)}
        >
          {#snippet icon()}
            <RotateCw size={11} />
          {/snippet}
        </SliderControl>
      </div>
    </PanelSection>
  </Tabs.Content>

  <Tabs.Content value="image">
    <PanelSection
      title="Image"
      hint="Imported images fit to cover the full canvas."
      flush
    >
      {#snippet action()}
        <Button
          variant="outline"
          size="xs"
          class="gap-1.5"
          onclick={pickBackgroundImage}
        >
          <FolderOpen size={11} />
          {store.backgroundValue ? "Replace" : "Choose"}
        </Button>
      {/snippet}
      {#if store.backgroundValue && isValidImageValue(store.backgroundValue)}
        <div
          class="overflow-hidden rounded-md border border-border bg-background"
        >
          <Image
            src={getImagePreviewSrc(store.backgroundValue)}
            alt="Selected background"
            layout="constrained"
            width={320}
            aspectRatio={16 / 9}
            objectFit="cover"
            loading="lazy"
            decoding="async"
            class="max-h-56 w-full"
          />
        </div>
      {:else}
        <div
          class="flex h-20 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-[11px] text-muted-foreground"
        >
          No image selected
        </div>
      {/if}

      {#if store.backgroundValue && isValidImageValue(store.backgroundValue)}
        <div class="mt-2.5">
          {@render blurControl()}
        </div>
      {/if}
    </PanelSection>
  </Tabs.Content>
  </Tabs.Root>
</div>
