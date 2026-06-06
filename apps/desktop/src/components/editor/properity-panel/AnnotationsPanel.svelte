<script lang="ts">
  import { kindIcon, kindLabel } from "$lib/annotations/kind-label";
  import {
    FONT_FAMILIES,
    FONT_WEIGHTS,
    STROKE_SWATCHES,
  } from "$lib/annotations/palette";
  import {
    getRecentColors,
    pushRecentColor,
  } from "$lib/annotations/recent-colors";
  import { EASE } from "$lib/easing/cubic-bezier";
  import {
    DEFAULT_ANNOTATION_RAMP,
    type Annotation,
    type AnnotationKindName,
    type EditorStore,
  } from "$lib/stores/editor-store.svelte";
  import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ArrowUpRight,
    Circle,
    Droplets,
    MousePointer2,
    Square,
    SquareDashedMousePointer,
    Trash2,
    Type as TypeIcon,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { ColorField } from "@recast/ui/color-field";
  import { Kbd } from "@recast/ui/kbd";
  import { Segmented } from "@recast/ui/segmented";
  import { SegmentedToggle } from "@recast/ui/segmented";
  import * as Select from "@recast/ui/select";
  import { SliderControl } from "@recast/ui/slider-control";
  import { Textarea } from "@recast/ui/textarea";
  import { cn } from "@recast/ui/utils";
  import BezierEditor from "../_components/BezierEditor.svelte";
  import AnnotationAppearance from "./annotations/AnnotationAppearance.svelte";
  import AnnotationGeometry from "./annotations/AnnotationGeometry.svelte";
  import AnnotationLayerPanel from "./annotations/AnnotationLayerPanel.svelte";
  import PanelSection from "./PanelSection.svelte";

  interface Props {
    store: EditorStore;
  }

  let { store }: Props = $props();

  let recents = $state<string[]>(getRecentColors());
  function rememberColor(color: string) {
    recents = pushRecentColor(color);
  }

  const selected = $derived<Annotation | null>(
    store.annotations.find((a) => a.id === store.selectedAnnotationId) ?? null,
  );

  // Which ramp the Fade-curves editor targets — one large graph at a time
  // (matches the Focus panel) instead of two cramped side-by-side editors.
  let customCurve = $state<"in" | "out">("in");

  type ToolDef = {
    id: AnnotationKindName | "select";
    label: string;
    icon: typeof Square;
    hotkey: string;
  };

  // Working tools only. (Image/polygon roadmap entries were removed — a
  // disabled, locked tile is clutter, not discovery.)
  const tools: ToolDef[] = [
    { id: "select", label: "Select", icon: MousePointer2, hotkey: "V" },
    { id: "rect", label: "Rectangle", icon: Square, hotkey: "R" },
    { id: "ellipse", label: "Ellipse", icon: Circle, hotkey: "O" },
    { id: "arrow", label: "Arrow", icon: ArrowUpRight, hotkey: "A" },
    { id: "text", label: "Text", icon: TypeIcon, hotkey: "T" },
    { id: "blur", label: "Blur", icon: Droplets, hotkey: "B" },
  ];

  function setTool(id: ToolDef["id"]) {
    if (id === "select") {
      store.annotationTool = null;
      return;
    }
    store.annotationTool = store.annotationTool === id ? null : id;
  }

  // Tool hotkeys. Suppressed when focus is in an editable element so typing
  // in a text annotation or any input doesn't switch tools.
  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function handleHotkey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const tool = tools.find((t) => t.hotkey.toLowerCase() === key);
    if (!tool) return;
    event.preventDefault();
    setTool(tool.id);
  }


  function fmtTime(sec: number): string {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}:${rem.toFixed(2).padStart(5, "0")}`;
  }

  function updateSelected(updates: Partial<Annotation>, trackUndo = false) {
    if (!selected) return;
    if (trackUndo) store.pushUndoState();
    store.updateAnnotation(selected.id, updates);
  }

  function resetCurves() {
    if (!selected) return;
    store.pushUndoState();
    store.updateAnnotation(selected.id, {
      easeIn: { ...EASE },
      easeOut: { ...EASE },
      rampIn: DEFAULT_ANNOTATION_RAMP,
      rampOut: DEFAULT_ANNOTATION_RAMP,
    });
  }

  function maxRamp(a: Annotation): number {
    return Math.max(0, (a.end - a.start) * 0.5);
  }

  // Tool status hint shown beneath the palette while a tool is active.
  const toolHint = $derived.by(() => {
    switch (store.annotationTool) {
      case "rect":
      case "ellipse":
        return "Drag on the preview to draw a shape.";
      case "arrow":
        return "Drag from start to end on the preview.";
      case "text":
        return "Drag a box on the preview, then type.";
      case "blur":
        return "Drag a region to obscure — applied at export.";
      default:
        return "";
    }
  });
</script>

<!-- Local, focus-aware tool hotkeys (V/R/O/A/T/B — documented in the central
     shortcut registry). `<svelte:window>` so HMR can't leak the listener. -->
<svelte:window onkeydown={handleHotkey} />

<div class="flex flex-col gap-4 animate-in fade-in duration-200">
  <!-- Tools — the "create" surface, at the top (the way you add annotations). -->
  <PanelSection
    title="Tools"
    hint="Pick a tool, then drag on the preview. Annotations are anchored in video-space so they follow zoom and crop. Press Esc to cancel placement; hold Alt while dragging to bypass snap."
    flush
  >
    {#snippet action()}
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted-foreground">Snap</span>
        <SegmentedToggle
          checked={store.annotationSnapEnabled}
          size="xs"
          aria-label="Snap to guides"
          onCheckedChange={(next) => (store.annotationSnapEnabled = next)}
        />
      </div>
    {/snippet}

    <div class="grid grid-cols-3 gap-1">
      {#each tools as tool (tool.id)}
        {@const Icon = tool.icon}
        {@const isActive =
          tool.id === "select"
            ? store.annotationTool === null
            : store.annotationTool === tool.id}
        <button
          type="button"
          aria-pressed={isActive}
          onclick={() => setTool(tool.id)}
          title={`${tool.label} (${tool.hotkey})`}
          class={cn(
            "group flex h-12 flex-col items-center justify-center gap-1 rounded-md border text-[10px] font-medium transition-all duration-150",
            "focus:outline-none focus:ring-2 focus:ring-ring/40",
            isActive
              ? "border-primary/60 bg-primary/10 text-primary shadow-(--shadow-craft-inset)"
              : "border-border/60 bg-card/60 text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          <Icon size={14} />
          <span class="leading-none">{tool.label}</span>
        </button>
      {/each}
    </div>
    {#if toolHint}
      <p class="mt-1.5 text-[10px] text-muted-foreground">
        {toolHint}
        <Kbd class="ml-1">Esc</Kbd>
        to cancel.
      </p>
    {/if}
  </PanelSection>

  <!-- Layers -->
  {#if store.annotations.length === 0}
    <div
      class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-3 py-6 text-center"
    >
      <div
        class="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-card/70 text-muted-foreground shadow-(--shadow-craft-inset)"
      >
        <SquareDashedMousePointer size={16} />
      </div>
      <p class="text-[11px] font-medium text-foreground">No annotations yet</p>
      <p class="text-[10px] leading-snug text-muted-foreground">
        Pick a tool above, then drag on the preview.
      </p>
    </div>
  {:else}
    <AnnotationLayerPanel {store} />
  {/if}

  <!-- Selected annotation editor — appearance & content lead; timing, fade
       curves, and geometry collapse below (what you reach for after drawing). -->
  {#if selected}
    {@const a = selected}
    {@const Icon = kindIcon(a)}
    <div class="flex flex-col gap-3 border-t border-border/50 pt-3">
      <!-- Orientation header + delete -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span
            class="grid size-5 shrink-0 place-items-center rounded bg-primary/15 text-primary"
          >
            <Icon size={11} />
          </span>
          <div class="min-w-0">
            <p
              class="truncate text-[11px] font-semibold tracking-tight text-foreground"
            >
              {kindLabel(a)}
            </p>
            <p class="text-[10px] tabular-nums text-muted-foreground">
              {fmtTime(a.start)}–{fmtTime(a.end)}
            </p>
          </div>
        </div>
        <Button
          variant="destructive_soft"
          size="xs"
          class="shrink-0 gap-1.5"
          onclick={() => store.removeAnnotation(a.id)}
        >
          <Trash2 size={11} />
          Delete
        </Button>
      </div>

      <!-- Text content + typography (text's primary edit surface) -->
      {#if a.kind.kind === "text"}
        {@const k = a.kind}
        {@const currentFont =
          FONT_FAMILIES.find((f) => f.value === k.fontFamily)?.label ?? "Font"}
        <PanelSection title="Text">
          <div class="flex flex-col gap-1">
            <span class="text-[10px] text-muted-foreground">Content</span>
            <Textarea
              rows={2}
              value={k.content}
              onfocus={() => store.pushUndoState()}
              oninput={(e) => {
                if (a.kind.kind !== "text") return;
                updateSelected({
                  kind: {
                    ...a.kind,
                    content: (e.currentTarget as HTMLTextAreaElement).value,
                  },
                });
              }}
              class="min-h-14 resize-none text-[11px]"
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted-foreground">Font</span>
            <Select.Root
              type="single"
              value={k.fontFamily}
              onValueChange={(v: string) => {
                if (a.kind.kind !== "text") return;
                store.pushUndoState();
                updateSelected({ kind: { ...a.kind, fontFamily: v } });
              }}
            >
              <Select.Trigger
                size="sm"
                class="h-7 w-40 gap-1 rounded-md border-border/60 px-2 text-[11px]"
                aria-label="Font family"
              >
                <span data-slot="select-value" style="font-family: {k.fontFamily}">
                  {currentFont}
                </span>
              </Select.Trigger>
              <Select.Content align="end" sideOffset={6} class="w-44 p-1">
                {#each FONT_FAMILIES as font (font.value)}
                  <Select.Item
                    value={font.value}
                    label={font.label}
                    class="text-[11.5px]"
                  >
                    <span style="font-family: {font.value}">{font.label}</span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <SliderControl
            label="Size"
            value={k.fontSize * 100}
            min={2}
            max={20}
            step={0.5}
            unit="%"
            description="Percentage of canvas height."
            formatValue={(v) => `${v.toFixed(1)}%`}
            onstart={() => store.pushUndoState()}
            onchange={(v) => {
              if (a.kind.kind !== "text") return;
              updateSelected({ kind: { ...a.kind, fontSize: v / 100 } });
            }}
          />

          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted-foreground">Weight</span>
            <Segmented
              size="xs"
              fill={false}
              aria-label="Font weight"
              value={String(k.fontWeight)}
              options={FONT_WEIGHTS.map((w) => ({
                value: String(w.value),
                label: w.label,
                title: w.title,
              }))}
              onValueChange={(v) => {
                if (a.kind.kind !== "text") return;
                store.pushUndoState();
                updateSelected({
                  kind: {
                    ...a.kind,
                    fontWeight: Number(v) as 400 | 500 | 600 | 700,
                  },
                });
              }}
            />
          </div>

          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted-foreground">Align</span>
            {#snippet alignLeftIcon()}<AlignLeft size={12} />{/snippet}
            {#snippet alignCenterIcon()}<AlignCenter size={12} />{/snippet}
            {#snippet alignRightIcon()}<AlignRight size={12} />{/snippet}
            <Segmented
              size="xs"
              fill={false}
              aria-label="Text alignment"
              value={k.align}
              options={[
                { value: "left", icon: alignLeftIcon, title: "Left" },
                { value: "center", icon: alignCenterIcon, title: "Center" },
                { value: "right", icon: alignRightIcon, title: "Right" },
              ]}
              onValueChange={(v) => {
                if (a.kind.kind !== "text") return;
                store.pushUndoState();
                updateSelected({
                  kind: {
                    ...a.kind,
                    align: v as "left" | "center" | "right",
                  },
                });
              }}
            />
          </div>

          <ColorField
            label="Color"
            value={k.color}
            swatches={STROKE_SWATCHES}
            {recents}
            oncommit={(c: string) => {
              if (a.kind.kind !== "text") return;
              store.pushUndoState();
              updateSelected({ kind: { ...a.kind, color: c } });
              rememberColor(c);
            }}
          />
        </PanelSection>
      {/if}

      <!-- Blur is its own primary edit surface -->
      {#if a.kind.kind === "blur"}
        {@const k = a.kind}
        <PanelSection title="Blur">
          <SliderControl
            label="Strength"
            value={k.strength * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            description="How much the underlying pixels are softened. Applied at export."
            formatValue={(v) => `${v.toFixed(0)}%`}
            onstart={() => store.pushUndoState()}
            onchange={(v) => {
              if (a.kind.kind !== "blur") return;
              updateSelected({ kind: { ...a.kind, strength: v / 100 } });
            }}
          />
          <SliderControl
            label="Corner radius"
            value={k.radius * 1000}
            min={0}
            max={50}
            step={1}
            unit="‰"
            formatValue={(v) => `${v.toFixed(0)}‰`}
            onstart={() => store.pushUndoState()}
            onchange={(v) => {
              if (a.kind.kind !== "blur") return;
              updateSelected({ kind: { ...a.kind, radius: v / 1000 } });
            }}
          />
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted-foreground">Style</span>
            <Segmented
              size="xs"
              fill={false}
              aria-label="Blur style"
              value={k.variant}
              options={[
                { value: "glass", label: "Glass" },
                { value: "white", label: "White" },
                { value: "black", label: "Black" },
                { value: "color", label: "Color" },
              ]}
              onValueChange={(v) => {
                if (a.kind.kind !== "blur") return;
                store.pushUndoState();
                updateSelected({
                  kind: {
                    ...a.kind,
                    variant: v as "glass" | "white" | "black" | "color",
                  },
                });
              }}
            />
          </div>
          {#if k.variant === "color"}
            <ColorField
              label="Tint"
              value={k.tintColor}
              swatches={STROKE_SWATCHES}
              {recents}
              oncommit={(c: string) => {
                if (a.kind.kind !== "blur") return;
                store.pushUndoState();
                updateSelected({ kind: { ...a.kind, tintColor: c } });
                rememberColor(c);
              }}
            />
          {/if}
        </PanelSection>
      {/if}

      <!-- Appearance: stroke / fill / opacity / glow (adapts per kind) -->
      <AnnotationAppearance {store} annotation={a} />

      <!-- Shape-specific finishing -->
      {#if a.kind.kind === "rect"}
        {@const k = a.kind}
        <PanelSection title="Shape">
          <SliderControl
            label="Corner radius"
            value={k.radius * 1000}
            min={0}
            max={50}
            step={1}
            unit="‰"
            formatValue={(v) => `${v.toFixed(0)}‰`}
            onstart={() => store.pushUndoState()}
            onchange={(v) => {
              if (a.kind.kind !== "rect") return;
              updateSelected({ kind: { ...a.kind, radius: v / 1000 } });
            }}
          />
        </PanelSection>
      {/if}

      {#if a.kind.kind === "arrow"}
        {@const k = a.kind}
        <PanelSection title="Arrowhead">
          <SliderControl
            label="Head size"
            value={k.headSize * 100}
            min={5}
            max={40}
            step={1}
            unit="%"
            description="Length of the arrowhead as a percentage of the line."
            formatValue={(v) => `${v.toFixed(0)}%`}
            onstart={() => store.pushUndoState()}
            onchange={(v) => {
              if (a.kind.kind !== "arrow") return;
              updateSelected({ kind: { ...a.kind, headSize: v / 100 } });
            }}
          />
        </PanelSection>
      {/if}

      <!-- Timing -->
      <PanelSection title="Timing" collapsible defaultOpen>
        <SliderControl
          label="Start"
          value={a.start}
          min={0}
          max={Math.max(a.end - 0.1, 0)}
          step={0.05}
          unit="s"
          formatValue={(v) => `${v.toFixed(2)}s`}
          onstart={() => store.pushUndoState()}
          onchange={(v) => updateSelected({ start: v })}
        />
        <SliderControl
          label="End"
          value={a.end}
          min={a.start + 0.1}
          max={store.metadata?.duration ?? a.end}
          step={0.05}
          unit="s"
          formatValue={(v) => `${v.toFixed(2)}s`}
          onstart={() => store.pushUndoState()}
          onchange={(v) => updateSelected({ end: v })}
        />
        <SliderControl
          label="Fade in"
          value={a.rampIn}
          min={0}
          max={Math.max(maxRamp(a), 0.01)}
          step={0.01}
          unit="s"
          formatValue={(v) => `${v.toFixed(2)}s`}
          onstart={() => store.pushUndoState()}
          onchange={(v) => updateSelected({ rampIn: v })}
        />
        <SliderControl
          label="Fade out"
          value={a.rampOut}
          min={0}
          max={Math.max(maxRamp(a), 0.01)}
          step={0.01}
          unit="s"
          formatValue={(v) => `${v.toFixed(2)}s`}
          onstart={() => store.pushUndoState()}
          onchange={(v) => updateSelected({ rampOut: v })}
        />
      </PanelSection>

      <!-- Fade curves: one large editor, switched in/out (matches Focus). -->
      <PanelSection title="Fade curves" collapsible defaultOpen={false}>
        {#snippet action()}
          <Button variant="ghost" size="xs" onclick={resetCurves}>Reset</Button>
        {/snippet}
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-medium text-muted-foreground">
              Editing the fade-{customCurve} curve
            </span>
            <SegmentedToggle
              checked={customCurve === "out"}
              offLabel="In"
              onLabel="Out"
              size="xs"
              aria-label="Edit fade-in or fade-out curve"
              onCheckedChange={(next) => (customCurve = next ? "out" : "in")}
            />
          </div>
          <BezierEditor
            value={customCurve === "in" ? a.easeIn : a.easeOut}
            onchange={(v) =>
              updateSelected(
                customCurve === "in" ? { easeIn: v } : { easeOut: v },
                true,
              )}
            showPresets={false}
            size={220}
          />
        </div>
      </PanelSection>

      <!-- Geometry: numeric box + frame alignment (power-user, collapsed). -->
      <AnnotationGeometry {store} annotation={a} />
    </div>
  {:else if store.annotations.length > 0}
    <p
      class="rounded-xl border border-dashed border-border/70 bg-card/40 px-3 py-3 text-center text-[10px] text-muted-foreground"
    >
      Select a layer to edit its appearance, timing, and geometry.
    </p>
  {/if}
</div>
