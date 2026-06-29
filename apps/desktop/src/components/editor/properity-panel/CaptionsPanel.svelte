<script lang="ts">
  import { clock } from "$lib/format/time";
  import { formatSize } from "$lib/format/files";
  import {
    captionCapabilities,
    deleteCaptionModel,
    downloadCaptionModel,
    listCaptionModels,
    transcribeProject,
    type CaptionModelInfo,
    type DeviceCapabilities,
    type Transcript,
  } from "$lib/ipc";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import {
    AlertTriangle,
    Check,
    Cpu,
    Download,
    Loader2,
    Lock,
    Sparkles,
    Trash2,
    Zap,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
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
  let downloadingId = $state<string | null>(null);
  let downloadPct = $state(0);
  let transcribing = $state(false);
  let phase = $state<string>("");
  let transcript = $state<Transcript | null>(null);
  let error = $state<string | null>(null);

  // Selectable = installed AND able to run on this device.
  const usable = $derived(models.filter((m) => m.installed && m.runnable));
  const hasAudio = $derived(!!(store.audioPath || store.microphonePath));

  const gpuLabel = $derived.by(() => {
    if (!caps) return "";
    if (caps.gpu.available) return caps.gpu.backend?.toUpperCase() ?? "GPU";
    return "CPU only";
  });

  async function refresh() {
    try {
      models = await listCaptionModels();
      // Default the selection to a usable installed model (default first).
      if (!selectedModelId || !usable.some((m) => m.id === selectedModelId)) {
        selectedModelId =
          usable.find((m) => m.isDefault)?.id ?? usable[0]?.id ?? null;
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
    if (!selectedModelId || !hasAudio) return;
    transcribing = true;
    phase = "extracting";
    error = null;
    try {
      transcript = await transcribeProject({
        audioPath: store.audioPath,
        microphonePath: store.microphonePath,
        modelId: selectedModelId,
      });
    } catch (e) {
      error = `${e}`;
      transcript = null;
    } finally {
      transcribing = false;
      phase = "";
    }
  }
</script>

<div
  class="flex flex-col gap-4"
  in:fly={{ y: 8, duration: 260, delay: 40, easing: cubicOut }}
>
  <PanelSection
    title="Model"
    hint="Transcription runs entirely on your device — no upload, no account. Pick a model, download it once, then generate captions."
    flush
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

    <div class="flex flex-col gap-1.5">
      {#each models as model (model.id)}
        {@const isSelected = selectedModelId === model.id}
        {@const isDownloading = downloadingId === model.id}
        {@const selectable = model.installed && model.runnable}
        <div
          class={cn(
            "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
            selectable && isSelected
              ? "border-primary/50 bg-primary/5"
              : "border-border/60 bg-card/40",
            !model.runnable && "opacity-60",
          )}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            disabled={!selectable}
            onclick={() => (selectedModelId = model.id)}
            title={selectable ? "Use this model" : undefined}
          >
            <span
              class={cn(
                "grid size-7 shrink-0 place-items-center rounded-md",
                selectable && isSelected
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              {#if !model.runnable}
                <Lock size={12} />
              {:else if selectable && isSelected}
                <Check size={13} />
              {:else}
                <Sparkles size={13} />
              {/if}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <p class="truncate text-[12px] font-semibold text-foreground">
                  {model.displayName}
                </p>
                {#if model.isDefault}
                  <span
                    class="rounded bg-muted/70 px-1 py-px text-[8.5px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Default
                  </span>
                {/if}
              </div>
              <p class="truncate text-[10px] text-muted-foreground">
                {model.engine === "parakeet" ? "Parakeet" : "Whisper"}
                {#if model.approxSizeBytes}· {formatSize(model.approxSizeBytes)}{/if}
                {#if model.installed}· Installed{/if}
              </p>
              {#if model.warning}
                <p
                  class={cn(
                    "mt-0.5 flex items-start gap-1 text-[9.5px] leading-tight",
                    model.runnable ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  <AlertTriangle size={9} class="mt-px shrink-0" />
                  <span>{model.warning}</span>
                </p>
              {/if}
            </div>
          </button>

          {#if !model.runnable}
            <span
              class="shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70"
            >
              GPU
            </span>
          {:else if isDownloading}
            <div class="flex w-16 shrink-0 items-center gap-1.5">
              <div class="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  class="absolute inset-y-0 left-0 bg-primary transition-all"
                  style="width: {downloadPct}%"
                ></div>
              </div>
              <span class="text-[9px] tabular-nums text-muted-foreground">{downloadPct}%</span>
            </div>
          {:else if model.installed}
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-7 text-muted-foreground hover:text-destructive"
              title="Remove download"
              onclick={() => handleDelete(model.id)}
            >
              <Trash2 size={13} />
            </Button>
          {:else if model.downloadable}
            <Button
              variant="ghost"
              size="xs"
              class="h-7 gap-1 text-[11px]"
              disabled={!!downloadingId}
              onclick={() => handleDownload(model.id)}
            >
              <Download size={12} /> Get
            </Button>
          {:else}
            <span class="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/70">
              Soon
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </PanelSection>

  <PanelSection
    title="Generate"
    hint="Captions are auto-detected for language. Generating reads the recording's audio and runs the model locally."
    flush
  >
    <Button
      variant="default"
      size="sm"
      class="w-full gap-1.5"
      disabled={!selectedModelId || !hasAudio || transcribing}
      onclick={generate}
    >
      {#if transcribing}
        <Loader2 size={14} class="animate-spin" />
        {phase === "extracting" ? "Reading audio…" : "Transcribing…"}
      {:else}
        <Sparkles size={14} />
        Generate captions
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
  </PanelSection>

  {#if transcript && transcript.segments.length > 0}
    <PanelSection title="Transcript" hint="Click a line to jump the playhead there." flush>
      <div class="flex flex-col gap-0.5">
        {#each transcript.segments as seg (seg.id)}
          <button
            type="button"
            class="group flex items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
            onclick={() => (store.currentTime = seg.start)}
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
