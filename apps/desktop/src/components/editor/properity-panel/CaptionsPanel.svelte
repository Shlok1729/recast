<script lang="ts">
  import { clock } from "$lib/format/time";
  import { formatSize } from "$lib/format/files";
  import {
    captionCapabilities,
    deleteCaptionModel,
    downloadCaptionModel,
    exportCaptions,
    listCaptionModels,
    transcribeProject,
    type CaptionModelInfo,
    type DeviceCapabilities,
  } from "$lib/ipc";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import {
    AlertTriangle,
    Check,
    ChevronsUpDown,
    Cpu,
    Download,
    FileDown,
    Loader2,
    Lock,
    Sparkles,
    Trash2,
    Zap,
    Package
  } from "@lucide/svelte";
  import { getRecentColors, pushRecentColor } from "$lib/annotations/recent-colors";
  import FontPicker from "./FontPicker.svelte";
  import { Button } from "@recast/ui/button";
  import { ColorPicker } from "@recast/ui/color-picker";
  import * as Command from "@recast/ui/command";
  import * as Popover from "@recast/ui/popover";
  import { Segmented, SegmentedToggle } from "@recast/ui/segmented";
  import { SliderControl } from "@recast/ui/slider-control";
  import { toast } from "@recast/ui/sonner";
  import { cn } from "@recast/ui/utils";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import PanelSection from "./PanelSection.svelte";

  interface Props {
    store: EditorStore;
  }
  let { store }: Props = $props();

  let models = $state<CaptionModelInfo[]>([]);
  let caps = $state<DeviceCapabilities | null>(null);
  let selectedModelId = $state<string | null>(null);
  let pickerOpen = $state(false);
  let downloadingId = $state<string | null>(null);
  let downloadPct = $state(0);
  let transcribing = $state(false);
  let phase = $state<string>("");
  let error = $state<string | null>(null);

  const selected = $derived(models.find((m) => m.id === selectedModelId) ?? null);
  const usable = $derived(models.filter((m) => m.installed && m.runnable));
  const hasAudio = $derived(!!(store.audioPath || store.microphonePath));
  const isDownloadingSelected = $derived(!!selected && downloadingId === selected.id);

  // Group models by family, preserving first-seen order, for the picker.
  const families = $derived.by(() => {
    const groups: { name: string; models: CaptionModelInfo[] }[] = [];
    for (const m of models) {
      let g = groups.find((x) => x.name === m.family);
      if (!g) {
        g = { name: m.family, models: [] };
        groups.push(g);
      }
      g.models.push(m);
    }
    return groups;
  });

  const gpuLabel = $derived.by(() => {
    if (!caps) return "";
    return caps.gpu.available ? (caps.gpu.backend?.toUpperCase() ?? "GPU") : "CPU only";
  });

  async function refresh() {
    try {
      models = await listCaptionModels();
      if (!selectedModelId || !models.some((m) => m.id === selectedModelId)) {
        selectedModelId =
          usable.find((m) => m.isDefault)?.id ??
          usable[0]?.id ??
          models.find((m) => m.isDefault)?.id ??
          models[0]?.id ??
          null;
      }
    } catch (e) {
      toast.error(`Could not load caption models: ${e}`);
    }
  }

  onMount(() => {
    void refresh();
    captionCapabilities()
      .then((c) => (caps = c))
      .catch(() => {});
    const unDownload = listen<{
      modelId: string;
      file: string;
      downloaded: number;
      total: number;
    }>("captions:download-progress", (e) => {
      if (e.payload.modelId !== downloadingId) return;
      downloadPct = e.payload.total > 0
        ? Math.min(100, Math.round((e.payload.downloaded / e.payload.total) * 100))
        : 0;
    });
    const unPhase = listen<{ phase: string }>("captions:transcribe-progress", (e) => {
      phase = e.payload.phase;
    });
    return () => {
      void unDownload.then((f) => f());
      void unPhase.then((f) => f());
    };
  });

  function pick(id: string) {
    selectedModelId = id;
    pickerOpen = false;
  }

  async function handleDownload(id: string) {
    downloadingId = id;
    downloadPct = 0;
    try {
      await downloadCaptionModel(id);
      toast.success("Model downloaded");
      await refresh();
    } catch (e) {
      toast.error(`Download failed: ${e}`);
    } finally {
      downloadingId = null;
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCaptionModel(id);
      await refresh();
    } catch (e) {
      toast.error(`Could not delete model: ${e}`);
    }
  }

  async function generate() {
    if (!selected || !selected.installed || !selected.runnable || !hasAudio) return;
    transcribing = true;
    phase = "extracting";
    error = null;
    try {
      store.transcript = await transcribeProject({
        audioPath: store.audioPath,
        microphonePath: store.microphonePath,
        modelId: selected.id,
      });
    } catch (e) {
      error = `${e}`;
      store.transcript = null;
    } finally {
      transcribing = false;
      phase = "";
    }
  }

  async function exportSubs(format: "srt" | "vtt") {
    const t = store.transcript;
    if (!t) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        defaultPath: `captions.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!dest) return;
      await exportCaptions(t, format, dest);
      toast.success(`Exported ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(`Export failed: ${e}`);
    }
  }

  const positionOptions = [
    { value: "top", label: "Top" },
    { value: "center", label: "Center" },
    { value: "bottom", label: "Bottom" },
  ];
  const backgroundOptions = [
    { value: "none", label: "None" },
    { value: "soft", label: "Shadow" },
    { value: "box", label: "Box" },
  ];

  const weightOptions = [
    { value: "400", label: "Regular" },
    { value: "600", label: "Semibold" },
    { value: "800", label: "Bold" },
  ];
  const CAPTION_SWATCHES = ["#ffffff", "#000000", "#facc15", "#22d3ee", "#f472b6"];

  let recents = $state<string[]>(getRecentColors());
  function rememberColor(c: string) {
    recents = pushRecentColor(c);
  }

  const langLabel = (m: CaptionModelInfo) =>
    m.languages.includes("multi") ? "Multilingual" : m.languages.join(", ").toUpperCase();
</script>

<div
  class="flex flex-col gap-4"
  in:fly={{ y: 8, duration: 260, delay: 40, easing: cubicOut }}
>
  <PanelSection
    title="Generate captions"
    hint="Transcription runs on your device. No upload, no account."
    flush
    collapsible
    defaultOpen={!store.transcript}
  >
    {#snippet action()}
      {#if caps}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-border/50 bg-card/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
          title={caps.gpu.name ?? gpuLabel}
        >
          {#if caps.gpu.available}
            <Zap size={9} class="text-primary" />
          {:else}
            <Cpu size={9} />
          {/if}
          {gpuLabel}
        </span>
      {/if}
    {/snippet}

    <!-- Combobox selector: only the chosen model shows here; the full list
         lives in the popover so the tab stays compact. -->
    <Popover.Root open={pickerOpen} onOpenChange={(v) => (pickerOpen = v)}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <button
            {...props as Record<string, unknown>}
            class="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-card"
          >
            <span
              class={cn(
                "grid size-7 shrink-0 place-items-center rounded-md",
                selected?.installed && selected?.runnable
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              {#if selected && !selected.runnable}
                <Lock size={13} />
              {:else}
                <Package size={13} />
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12px] font-semibold text-foreground">
                {selected?.displayName ?? "Select a model"}
              </span>
              {#if selected}
                <span class="block truncate text-[10px] text-muted-foreground">
                  {selected.family}{#if selected.installed} · Installed{/if}
                </span>
              {/if}
            </span>
            <ChevronsUpDown size={13} class="shrink-0 text-muted-foreground" />
          </button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="start" sideOffset={6} class="w-72 p-0">
        <Command.Root>
          <Command.Input placeholder="Search models…" class="h-9 text-[12px]" />
          <Command.List class="max-h-72 scrollbar-transparent">
            <Command.Empty class="py-6 text-center text-[11px] text-muted-foreground">
              No models found
            </Command.Empty>
            {#each families as fam (fam.name)}
              <Command.Group heading={fam.name}>
                {#each fam.models as m (m.id)}
                  <Command.Item
                    value={`${m.displayName} ${m.family} ${m.engine}`}
                    onSelect={() => pick(m.id)}
                    class="gap-2"
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      {#if m.id === selectedModelId}<Check size={13} class="text-primary" />{/if}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-[12px]">{m.displayName}</span>
                    {#if !m.runnable}
                      <Lock size={11} class="shrink-0 text-muted-foreground/70" />
                    {:else if m.installed}
                      <Check size={11} class="shrink-0 text-success" />
                    {/if}
                    {#if m.approxSizeBytes}
                      <span class="shrink-0 text-[9.5px] tabular-nums text-muted-foreground">
                        {formatSize(m.approxSizeBytes)}
                      </span>
                    {/if}
                  </Command.Item>
                {/each}
              </Command.Group>
            {/each}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>

    <!-- Selected-model detail -->
    {#if selected}
      <div class="mt-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
        <div class="flex flex-wrap items-center gap-1">
          <span
            class="rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {selected.engine === "parakeet" ? "Parakeet" : "Whisper"}
          </span>
          <span
            class="rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
          >
            {langLabel(selected)}
          </span>
          {#if selected.approxSizeBytes}
            <span
              class="rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground"
            >
              {formatSize(selected.approxSizeBytes)}
            </span>
          {/if}
          {#if selected.requiresGpu}
            <span class="rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
              Needs GPU
            </span>
          {:else if selected.prefersGpu}
            <span class="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              Faster with GPU
            </span>
          {/if}
          {#if selected.minRamBytes}
            <span
              class="rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground"
            >
              ≥ {formatSize(selected.minRamBytes)} RAM
            </span>
          {/if}
        </div>

        {#if selected.warning}
          <p
            class={cn(
              "mt-2 flex items-start gap-1.5 text-[10px] leading-tight",
              selected.runnable ? "text-warning" : "text-muted-foreground",
            )}
          >
            <AlertTriangle size={11} class="mt-px shrink-0" />
            <span>{selected.warning}</span>
          </p>
        {/if}

        <div class="mt-2.5">
          {#if !selected.runnable}
            <p class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Lock size={12} /> Unavailable on this device
            </p>
          {:else if isDownloadingSelected}
            <div class="flex items-center gap-2">
              <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  class="absolute inset-y-0 left-0 bg-primary transition-all"
                  style="width: {downloadPct}%"
                ></div>
              </div>
              <span class="text-[10px] tabular-nums text-muted-foreground">{downloadPct}%</span>
            </div>
          {:else if selected.installed}
            <div class="flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-[11px] font-medium text-success">
                <Check size={13} /> Installed
              </span>
              <Button
                variant="ghost"
                size="xs"
                class="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                onclick={() => handleDelete(selected.id)}
              >
                <Trash2 size={12} /> Remove
              </Button>
            </div>
          {:else if selected.downloadable}
            <Button
              variant="secondary"
              size="sm"
              class="w-full gap-1.5"
              disabled={!!downloadingId}
              onclick={() => handleDownload(selected.id)}
            >
              <Download size={13} /> Download model
            </Button>
          {:else}
            <p class="text-[11px] text-muted-foreground">Coming soon.</p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Generate lives in the same section as the model picker. -->
    <div class="mt-3 border-t border-border/50 pt-3">
      <Button
        variant="default"
        size="sm"
        class="w-full gap-1.5"
        disabled={!selected?.installed || !selected?.runnable || !hasAudio || transcribing}
        onclick={generate}
      >
        {#if transcribing}
          <Loader2 size={14} class="animate-spin" />
          {phase === "extracting" ? "Reading audio…" : "Transcribing…"}
        {:else}
          <Sparkles size={14} />
          {store.transcript ? "Regenerate captions" : "Generate captions"}
        {/if}
      </Button>

      {#if !hasAudio}
        <p class="mt-2 text-[10.5px] text-muted-foreground">
          This recording has no audio track to transcribe.
        </p>
      {:else if usable.length === 0}
        <p class="mt-2 text-[10.5px] text-muted-foreground">
          Download a model your device can run to enable captioning.
        </p>
      {/if}

      {#if error}
        <div
          class="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[10.5px] text-warning"
        >
          <AlertTriangle size={12} class="mt-px shrink-0" />
          <span class="min-w-0">{error}</span>
        </div>
      {/if}
    </div>
  </PanelSection>

  {#if store.transcript && store.transcript.segments.length > 0}
    {@const cs = store.captionStyle}
    <PanelSection title="Style" hint="How captions look over the preview and in burned-in exports." flush>
      {#snippet action()}
        <SegmentedToggle
          checked={cs.enabled}
          offLabel="Hidden"
          onLabel="Shown"
          size="xs"
          aria-label="Show captions in preview"
          onCheckedChange={(next) => store.updateCaptionStyle({ enabled: next })}
        />
      {/snippet}

      <div class="flex flex-col gap-3" class:opacity-50={!cs.enabled}>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Font
          </span>
          <FontPicker
            value={cs.fontFamily}
            weight={cs.fontWeight}
            onChange={(v) => store.updateCaptionStyle({ fontFamily: v })}
          />
        </div>

        <div>
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Weight
          </p>
          <Segmented
            size="xs"
            aria-label="Caption font weight"
            value={String(cs.fontWeight)}
            options={weightOptions}
            onValueChange={(v) => store.updateCaptionStyle({ fontWeight: parseInt(v, 10) })}
          />
        </div>

        <SliderControl
          label="Font size"
          value={cs.fontSizePct}
          min={2}
          max={10}
          step={0.5}
          unit="%"
          onchange={(next) => store.updateCaptionStyle({ fontSizePct: next })}
          formatValue={(v) => `${v}%`}
        />

        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Uppercase
          </span>
          <SegmentedToggle
            checked={cs.uppercase}
            offLabel="Off"
            onLabel="On"
            size="xs"
            aria-label="Uppercase captions"
            onCheckedChange={(next) => store.updateCaptionStyle({ uppercase: next })}
          />
        </div>

        <div class="space-y-1.5">
          <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Text color
          </span>
          {@render colorField(cs.color, (c) => store.updateCaptionStyle({ color: c }))}
        </div>

        <div>
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Position
          </p>
          <Segmented
            size="xs"
            aria-label="Caption position"
            value={cs.position}
            options={positionOptions}
            onValueChange={(v) =>
              store.updateCaptionStyle({ position: v as "top" | "center" | "bottom" })}
          />
        </div>

        <SliderControl
          label="Max lines"
          value={cs.maxLines}
          min={1}
          max={4}
          step={1}
          unit=""
          onchange={(next) => store.updateCaptionStyle({ maxLines: next })}
          formatValue={(v) => `${v}`}
        />
      </div>
    </PanelSection>

    <PanelSection
      title="Background & outline"
      hint="Keep captions legible over any footage with a backing box, a stroke, and finer spacing."
      flush
      collapsible
      defaultOpen={false}
    >
      <div class="flex flex-col gap-3" class:opacity-50={!cs.enabled}>
        <div>
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Background
          </p>
          <Segmented
            size="xs"
            aria-label="Caption background"
            value={cs.background}
            options={backgroundOptions}
            onValueChange={(v) =>
              store.updateCaptionStyle({ background: v as "none" | "soft" | "box" })}
          />
        </div>

        {#if cs.background === "box"}
          <div class="space-y-1.5">
            <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Box color
            </span>
            {@render colorField(cs.backgroundColor, (c) =>
              store.updateCaptionStyle({ backgroundColor: c }),
            )}
          </div>

          <SliderControl
            label="Box opacity"
            value={cs.backgroundOpacity}
            min={0}
            max={100}
            step={5}
            unit="%"
            onchange={(next) => store.updateCaptionStyle({ backgroundOpacity: next })}
            formatValue={(v) => `${v}%`}
          />
        {/if}

        <SliderControl
          label="Outline"
          value={cs.outlineWidth}
          min={0}
          max={10}
          step={0.5}
          unit=""
          onchange={(next) => store.updateCaptionStyle({ outlineWidth: next })}
          formatValue={(v) => (v === 0 ? "None" : `${v}`)}
        />

        {#if cs.outlineWidth > 0}
          <div class="space-y-1.5">
            <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Outline color
            </span>
            {@render colorField(cs.outlineColor, (c) =>
              store.updateCaptionStyle({ outlineColor: c }),
            )}
          </div>
        {/if}

        <SliderControl
          label="Letter spacing"
          value={cs.letterSpacing}
          min={-0.05}
          max={0.3}
          step={0.01}
          unit="em"
          onchange={(next) => store.updateCaptionStyle({ letterSpacing: next })}
          formatValue={(v) => `${v.toFixed(2)}em`}
        />

        <SliderControl
          label="Edge offset"
          value={cs.offsetPct}
          min={0}
          max={20}
          step={1}
          unit="%"
          onchange={(next) => store.updateCaptionStyle({ offsetPct: next })}
          formatValue={(v) => `${v}%`}
        />
      </div>
    </PanelSection>

    <PanelSection title="Transcript" hint="Click a line to jump the playhead there." flush>
      {#snippet action()}
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="xs" class="h-6 gap-1 text-[10px]" onclick={() => exportSubs("srt")}>
            <FileDown size={11} /> SRT
          </Button>
          <Button variant="ghost" size="xs" class="h-6 gap-1 text-[10px]" onclick={() => exportSubs("vtt")}>
            <FileDown size={11} /> VTT
          </Button>
        </div>
      {/snippet}

      <div class="flex flex-col gap-0.5">
        {#each store.transcript.segments as seg (seg.id)}
          <button
            type="button"
            class="group flex items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
            onclick={() => store.seek(seg.start)}
          >
            <span
              class="shrink-0 pt-px font-mono text-[9.5px] tabular-nums text-muted-foreground/70 group-hover:text-foreground"
            >
              {clock(seg.start)}
            </span>
            <span class="min-w-0 text-[11.5px] leading-snug text-foreground">{seg.text}</span>
          </button>
        {/each}
      </div>
    </PanelSection>
  {/if}
</div>

{#snippet colorField(current: string, onCommit: (color: string) => void)}
  <div class="flex flex-wrap items-center gap-1">
    {#each CAPTION_SWATCHES as swatch (swatch)}
      {@const isActive = current.toLowerCase() === swatch}
      <button
        type="button"
        aria-label={`Color ${swatch}`}
        aria-pressed={isActive}
        onclick={() => onCommit(swatch)}
        class={cn(
          "size-5 rounded-full border-2 transition",
          isActive ? "border-foreground shadow-sm" : "border-border/40 hover:border-border",
        )}
        style:background={swatch}
      ></button>
    {/each}
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <button
            type="button"
            {...props}
            aria-label="Custom color"
            class="grid size-5 place-items-center rounded-full border-2 border-dashed border-border/60 text-[11px] leading-none text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            +
          </button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="start" class="w-auto p-0">
        <ColorPicker
          value={current}
          {recents}
          oncommit={(c: string) => {
            onCommit(c);
            rememberColor(c);
          }}
        />
      </Popover.Content>
    </Popover.Root>
  </div>
{/snippet}
