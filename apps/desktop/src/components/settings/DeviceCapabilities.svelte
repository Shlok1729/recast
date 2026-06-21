<script lang="ts">
  import {
    captureCapabilities,
    diagnoseFfmpeg,
    probeVideoEncoders,
    type CaptureCapabilities,
    type EncoderAvailability,
    type FfmpegDiagnostics,
  } from "$lib/ipc";
  import {
    AppWindow,
    Check,
    ChevronDown,
    Cpu,
    Mic,
    Minus,
    MonitorCog,
    MonitorOff,
    MonitorPlay,
    MousePointer2,
    RefreshCw,
    Sparkles,
    SquareDashed,
    Video,
    Volume2,
    X,
    Zap,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { Button } from "@recast/ui/button";
  import * as Collapsible from "@recast/ui/collapsible";
  import { cn } from "@recast/ui/utils";
  import { onMount } from "svelte";

  // OS facts (best-effort — each os-plugin getter is wrapped so a blocked
  // permission or non-Tauri preview degrades to "Unknown" instead of
  // throwing the whole panel away).
  let osLabel = $state("Unknown");
  let osVersion = $state("");
  let osArch = $state("");
  // Raw platform key ("windows" / "macos" / …) kept alongside the display
  // label so the capture-support row can key off it without string-matching
  // the localized label. Empty until loadOsInfo resolves.
  let platform = $state("");

  let diagnostics = $state<FfmpegDiagnostics | null>(null);
  let encoders = $state<EncoderAvailability[]>([]);
  let probing = $state(true);
  let probeError = $state<string | null>(null);

  // Capture-support matrix — what this device's native APIs can actually
  // record, probed at runtime rather than hardcoded per platform.
  let captureCaps = $state<CaptureCapabilities | null>(null);
  let captureProbing = $state(true);
  let captureError = $state<string | null>(null);

  const PLATFORM_LABEL: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    ios: "iOS",
    android: "Android",
  };

  async function loadOsInfo() {
    try {
      const os = await import("@tauri-apps/plugin-os");
      try {
        const p = os.platform();
        platform = p;
        osLabel = PLATFORM_LABEL[p] ?? p;
      } catch {
        /* leave default */
      }
      try {
        osVersion = os.version();
      } catch {
        /* optional */
      }
      try {
        osArch = os.arch();
      } catch {
        /* optional */
      }
    } catch {
      // Not running under Tauri (browser preview) — leave the defaults.
    }
  }

  async function loadEngine() {
    probing = true;
    probeError = null;
    try {
      // ffmpeg metadata returns fast; the encoder matrix spawns ffmpeg per
      // hardware candidate (up to ~2s cold), so kick both off together and
      // let the matrix fill in when it resolves.
      const [diag, enc] = await Promise.all([
        diagnoseFfmpeg().catch(() => null),
        probeVideoEncoders(),
      ]);
      diagnostics = diag;
      encoders = enc;
    } catch (e) {
      probeError = String(e);
    } finally {
      probing = false;
    }
  }

  async function loadCapture() {
    captureProbing = true;
    captureError = null;
    try {
      captureCaps = await captureCapabilities();
    } catch (e) {
      captureError = String(e);
    } finally {
      captureProbing = false;
    }
  }

  onMount(() => {
    void loadOsInfo();
    void loadEngine();
    void loadCapture();
  });

  // `os.version()` returns the raw NT version on Windows — "10.0.26200" —
  // because Windows 11 still reports kernel 10.0; only the build number
  // (≥22000) distinguishes 11 from 10. Surface the marketing name + build
  // instead of the bare NT string so the panel reads "Windows 11 (Build
  // 26200)" rather than the confusing "10.0.26200".
  function windowsBuild(v: string): number | null {
    const m = /^\d+\.\d+\.(\d+)/.exec(v);
    return m ? Number(m[1]) : null;
  }

  const osName = $derived.by(() => {
    if (platform === "windows") {
      const build = windowsBuild(osVersion);
      if (build !== null) return build >= 22000 ? "Windows 11" : "Windows 10";
    }
    if (platform === "macos" && osVersion) return `macOS ${osVersion}`;
    return osLabel;
  });

  // Second fact row: the build (Windows) or raw version (kernel/Darwin
  // elsewhere). Labeled "Build" on Windows since that's the meaningful number.
  const osDetail = $derived.by(() => {
    if (platform === "windows") {
      const build = windowsBuild(osVersion);
      return build !== null ? String(build) : osVersion;
    }
    return osVersion;
  });

  // The "screen" row is the headline verdict — can this machine record its
  // screen at all? The rest of the matrix (audio, camera, cursor) hangs off
  // the collapsible list below.
  const screenCap = $derived(
    captureCaps?.capabilities.find((c) => c.key === "screen") ?? null,
  );
  const captureReady = $derived(screenCap?.supported ?? false);
  const captureHeadlineNote = $derived.by(() => {
    if (screenCap?.note) return screenCap.note;
    return captureReady
      ? "Recast can record your whole screen, a single window, or a selected region on this device."
      : "Screen recording isn't available on this device yet. Editing, sharing, and playback still work.";
  });
  let showCapture = $state(false);

  // Per-capability Lucide icon, keyed by the Rust `key`. Falls back to the
  // screen glyph for any future key the backend adds before the UI does.
  const CAP_ICON: Record<string, Component> = {
    screen: MonitorPlay,
    window: AppWindow,
    region: SquareDashed,
    systemAudio: Volume2,
    microphone: Mic,
    camera: Video,
    cursor: MousePointer2,
  };

  const facts = $derived(
    [
      { label: "Operating system", value: osName },
      { label: platform === "windows" ? "Build" : "Version", value: osDetail },
      { label: "Architecture", value: osArch },
      {
        label: "FFmpeg",
        value:
          diagnostics?.version?.replace(/^ffmpeg version\s*/i, "") ?? "Detecting…",
      },
    ].filter((f) => f.value),
  );

  // Group the probed encoders by codec family ("H.264" / "HEVC") so the
  // matrix renders a labeled section per codec instead of one flat list.
  // Order follows first-appearance in the probe result (H.264 then HEVC).
  const encoderGroups = $derived.by(() => {
    const groups: { family: string; items: EncoderAvailability[] }[] = [];
    for (const enc of encoders) {
      let group = groups.find((g) => g.family === enc.family);
      if (!group) {
        group = { family: enc.family, items: [] };
        groups.push(group);
      }
      group.items.push(enc);
    }
    return groups;
  });

  // The plain-language verdict: which encoder the recorder actually picked, and
  // whether it's a GPU (hardware) path. This is the one thing a non-technical
  // user needs — the per-codec matrix below is collapsed power-user detail.
  const activeEncoder = $derived(encoders.find((e) => e.active) ?? null);
  const isAccelerated = $derived(activeEncoder?.hardware ?? false);
  let showDetails = $state(false);
</script>

<div class="flex flex-col gap-3">
  <!-- Platform / engine facts -->
  <div
    class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
  >
    <div class="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
      <MonitorCog class="size-3.5 text-muted-foreground" />
      <span class="text-[11px] font-semibold text-foreground">Platform</span>
    </div>
    <dl class="divide-y divide-border/30">
      {#each facts as fact (fact.label)}
        <div class="flex items-center justify-between gap-3 px-4 py-2.5">
          <dt class="text-[11.5px] text-muted-foreground">{fact.label}</dt>
          <dd
            class="min-w-0 truncate font-mono text-[11px] text-foreground"
            title={fact.value}
          >
            {fact.value}
          </dd>
        </div>
      {/each}
    </dl>
  </div>

  <!-- Capture support — what this device's native APIs can actually record,
       probed at runtime (DXGI / AVFoundation / PipeWire / X11) rather than
       hardcoded per platform. -->
  <div
    class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
  >
    <div class="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
      <MonitorPlay class="size-3.5 text-muted-foreground" />
      <span class="text-[11px] font-semibold text-foreground">
        Capture support
      </span>
    </div>

    {#if captureProbing && !captureCaps}
      <div class="flex items-center gap-3 px-4 py-3.5">
        <div class="size-9 shrink-0 animate-pulse rounded-full bg-foreground/5"></div>
        <div class="flex-1 space-y-1.5">
          <div class="h-3 w-36 animate-pulse rounded bg-foreground/5"></div>
          <div class="h-2.5 w-full max-w-60 animate-pulse rounded bg-foreground/5"></div>
        </div>
      </div>
    {:else if captureError}
      <div class="px-4 py-3 text-[11px] text-destructive">
        Couldn't check capture support: {captureError}
      </div>
    {:else if captureCaps}
      <!-- Plain-language verdict: can this machine actually record its screen,
           and which native API does it use? -->
      <div class="flex items-start gap-3 px-4 py-3.5">
        <div
          class={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
            captureReady
              ? "bg-primary/15 text-primary ring-primary/25"
              : "bg-warning/12 text-warning ring-1 ring-warning/25",
          )}
        >
          {#if captureReady}
            <MonitorPlay class="size-4" />
          {:else}
            <MonitorOff class="size-4" />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-[13px] font-semibold text-foreground">
              {captureReady
                ? "Screen recording is ready"
                : "Screen recording isn't available here"}
            </span>
            <span
              class={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset",
                captureReady
                  ? "bg-primary/15 text-primary ring-primary/25"
                  : "bg-warning/12 text-warning ring-warning/25",
              )}
            >
              {captureCaps.screenBackend}
            </span>
          </div>
          <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {captureHeadlineNote}
          </p>
        </div>
      </div>

      <!-- Per-feature support matrix, collapsed by default — each row is the
           native API behind that capture input on this device. Collapsible
           gives it a smooth native `slide` (real height) transition. -->
      <Collapsible.Root bind:open={showCapture}>
        <Collapsible.Trigger
          class="flex w-full items-center justify-between gap-2 border-t border-border/30 px-4 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>Feature support</span>
          <ChevronDown
            class={cn("size-3.5 transition-transform", showCapture && "rotate-180")}
          />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ul class="divide-y divide-border/30">
          {#each captureCaps.capabilities as feat (feat.key)}
            {@const Icon = CAP_ICON[feat.key] ?? MonitorPlay}
            <li class="flex items-start justify-between gap-3 px-4 py-2.5">
              <div class="flex min-w-0 items-start gap-2.5">
                <div
                  class={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                    feat.supported
                      ? "bg-primary/10 text-primary ring-primary/20"
                      : "bg-foreground/5 text-muted-foreground/60 ring-border/40",
                  )}
                >
                  <Icon class="size-3.5" />
                </div>
                <div class="min-w-0">
                  <span class="block truncate text-[12px] font-semibold text-foreground">
                    {feat.label}
                  </span>
                  <div class="truncate font-mono text-[10px] text-muted-foreground">
                    {feat.backend}
                  </div>
                  {#if feat.note}
                    <p class="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
                      {feat.note}
                    </p>
                  {/if}
                </div>
              </div>
              <span
                class={cn(
                  "mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium",
                  feat.supported ? "text-success" : "text-muted-foreground/70",
                )}
              >
                {#if feat.supported}
                  <Check class="size-3.5" />
                  Supported
                {:else}
                  <X class="size-3.5" />
                  Unavailable
                {/if}
              </span>
            </li>
          {/each}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  </div>

  <!-- Hardware acceleration / encoder matrix -->
  <div
    class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
  >
    <div
      class="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5"
    >
      <div class="flex items-center gap-2">
        <Zap class="size-3.5 text-primary" />
        <span class="text-[11px] font-semibold text-foreground">
          Hardware acceleration
        </span>
      </div>
      <Button
        variant="ghost"
        size="xs"
        class="h-6 gap-1.5 text-[11px]"
        disabled={probing}
        onclick={loadEngine}
      >
        <RefreshCw class={cn("size-3", probing && "animate-spin")} />
        {probing ? "Checking…" : "Re-check"}
      </Button>
    </div>

    {#if probeError}
      <div class="px-4 py-3 text-[11px] text-destructive">
        Couldn't check hardware acceleration: {probeError}
      </div>
    {:else if probing && encoders.length === 0}
      <div class="flex items-center gap-3 px-4 py-3.5">
        <div class="size-9 shrink-0 animate-pulse rounded-full bg-foreground/5"></div>
        <div class="flex-1 space-y-1.5">
          <div class="h-3 w-32 animate-pulse rounded bg-foreground/5"></div>
          <div class="h-2.5 w-full max-w-60 animate-pulse rounded bg-foreground/5"></div>
        </div>
      </div>
    {:else}
      <!-- Plain-language verdict — the one thing a non-technical user needs:
           is recording using the graphics card (GPU) or the processor (CPU)? -->
      <div class="flex items-start gap-3 px-4 py-3.5">
        <div
          class={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
            isAccelerated
              ? "bg-primary/15 text-primary ring-primary/25"
              : "bg-foreground/5 text-muted-foreground ring-border/50",
          )}
        >
          {#if isAccelerated}
            <Zap class="size-5" />
          {:else}
            <Cpu class="size-5" />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-[13px] font-semibold text-foreground">
              {isAccelerated ? "Hardware accelerated" : "Running on your CPU"}
            </span>
            <span
              class={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset",
                isAccelerated
                  ? "bg-primary/15 text-primary ring-primary/25"
                  : "bg-foreground/5 text-muted-foreground/80 ring-border/50",
              )}
            >
              {isAccelerated ? `GPU · ${activeEncoder?.vendor ?? ""}` : "CPU only"}
            </span>
          </div>
          <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {#if isAccelerated}
              Recordings are encoded by your {activeEncoder?.vendor} graphics
              card, so capture stays smooth and your processor stays free for
              everything else.
            {:else}
              No graphics-card encoder was available, so recordings are encoded
              by your processor (CPU). It still works well — just expect higher
              CPU use while recording.
            {/if}
          </p>
        </div>
      </div>

      <!-- Per-codec matrix, collapsed by default — kept for power users and bug
           reports without making jargon the headline. Collapsible gives it a
           smooth native `slide` (real height) transition. -->
      <Collapsible.Root bind:open={showDetails}>
        <Collapsible.Trigger
          class="flex w-full items-center justify-between gap-2 border-t border-border/30 px-4 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>Technical details</span>
          <ChevronDown
            class={cn("size-3.5 transition-transform", showDetails && "rotate-180")}
          />
        </Collapsible.Trigger>
        <Collapsible.Content>
          {#each encoderGroups as group (group.family)}
          <div
            class="flex items-center gap-2 border-b border-border/30 bg-muted/20 px-4 py-1.5"
          >
            <span
              class="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70"
            >
              {group.family}
            </span>
          </div>
          <ul class="divide-y divide-border/30">
            {#each group.items as enc (enc.name)}
              <li class="flex items-center justify-between gap-3 px-4 py-2.5">
                <div class="flex min-w-0 items-center gap-2.5">
                  <div
                    class={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                      enc.available
                        ? "bg-primary/10 text-primary ring-primary/20"
                        : "bg-foreground/5 text-muted-foreground/60 ring-border/40",
                    )}
                  >
                    {#if enc.hardware}
                      <Zap class="size-3.5" />
                    {:else}
                      <Cpu class="size-3.5" />
                    {/if}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-[12px] font-semibold text-foreground">
                        {enc.label}
                      </span>
                      {#if enc.active}
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary"
                        >
                          <Sparkles class="size-2.5" />
                          In use
                        </span>
                      {/if}
                    </div>
                    <div class="truncate font-mono text-[10px] text-muted-foreground">
                      {enc.name} · {enc.vendor}
                    </div>
                  </div>
                </div>
                <span
                  class={cn(
                    "inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium",
                    enc.available ? "text-success" : "text-muted-foreground/70",
                  )}
                >
                  {#if enc.available}
                    <Check class="size-3.5" />
                    Available
                  {:else}
                    <X class="size-3.5" />
                    Unsupported
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/each}
        <p class="border-t border-border/30 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
          <Minus class="mr-0.5 inline size-3 -translate-y-px" />
          Recast records with the highest-priority available H.264 encoder.
          Hardware encoders (GPU) keep capture smooth on weaker CPUs; x264 is the
          always-on software fallback. HEVC rows are informational — which HEVC
          encoders this device exposes.
        </p>
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  </div>
</div>
