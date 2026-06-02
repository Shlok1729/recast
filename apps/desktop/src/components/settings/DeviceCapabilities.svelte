<script lang="ts">
  import {
    diagnoseFfmpeg,
    probeVideoEncoders,
    type EncoderAvailability,
    type FfmpegDiagnostics,
  } from "$lib/ipc";
  import {
    Check,
    Cpu,
    Minus,
    MonitorCog,
    MonitorPlay,
    RefreshCw,
    Sparkles,
    X,
    Zap,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
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

  onMount(() => {
    void loadOsInfo();
    void loadEngine();
  });

  const facts = $derived(
    [
      { label: "Operating system", value: osLabel },
      { label: "OS version", value: osVersion },
      { label: "Architecture", value: osArch },
      {
        label: "FFmpeg",
        value:
          diagnostics?.version?.replace(/^ffmpeg version\s*/i, "") ?? "Detecting…",
      },
    ].filter((f) => f.value),
  );
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
        Couldn't probe encoders: {probeError}
      </div>
    {:else if probing && encoders.length === 0}
      <div class="flex flex-col gap-2 px-4 py-3">
        {#each [0, 1, 2, 3] as i (i)}
          <div class="h-9 animate-pulse rounded-lg bg-foreground/5"></div>
        {/each}
      </div>
    {:else}
      <ul class="divide-y divide-border/30">
        {#each encoders as enc (enc.name)}
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
                enc.available ? "text-emerald-500" : "text-muted-foreground/70",
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
      <p class="border-t border-border/30 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
        <Minus class="mr-0.5 inline size-3 -translate-y-px" />
        Recast records with the highest-priority available encoder. Hardware
        encoders (GPU) keep capture smooth on weaker CPUs; x264 is the always-on
        software fallback.
      </p>
    {/if}
  </div>
</div>
