<script lang="ts">
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import {
    AudioLines,
    AudioWaveform,
    Mic,
    RotateCcw,
    Speaker,
    Waves,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { Segmented, SegmentedToggle } from "@recast/ui/segmented";
  import { SliderControl } from "@recast/ui/slider-control";
  import { cubicOut } from "svelte/easing";
  import { fly, scale } from "svelte/transition";
  import PanelSection from "./PanelSection.svelte";

  interface Props {
    store: EditorStore;
  }

  let { store }: Props = $props();

  type AudioSettings = EditorStore["audioSettings"];

  function updateAudioSettings(
    updates: Partial<AudioSettings>,
    trackUndo = false,
  ) {
    if (trackUndo) store.pushUndoState();
    store.updateAudioSettings(updates);
  }

  function toggleMute() {
    updateAudioSettings({ muted: !store.audioSettings.muted }, true);
  }
  function resetVolume() {
    updateAudioSettings({ volume: 100 }, true);
  }

  // M keyboard shortcut. Suppressed inside text inputs and contenteditable
  // (e.g. text annotations) so it doesn't fire while the user is typing.
  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function handleKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleMute();
    }
  }

  // Volume zones for the slider readout. Above 100% the export pipeline
  // applies straight gain, which can clip — surface that as a warning.
  type Zone = "muted" | "low" | "nominal" | "boost" | "hot";
  const volumeZone = $derived.by<Zone>(() => {
    if (store.audioSettings.muted) return "muted";
    const v = store.audioSettings.volume;
    if (v <= 0) return "muted";
    if (v < 70) return "low";
    if (v <= 105) return "nominal";
    if (v <= 150) return "boost";
    return "hot";
  });

  // dB-ish display ("0 dB" at 100%, calibrated as 20·log10(volume/100)). Not
  // strictly the same as the Rust ffmpeg `volume=` filter (which is a
  // multiplier on the linear sample value) but matches user intuition.
  function dbForVolume(v: number): string {
    if (v <= 0) return "−∞ dB";
    const db = 20 * Math.log10(v / 100);
    if (Math.abs(db) < 0.05) return "0.0 dB";
    return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
  }

  const FADE_PRESETS: Array<{ label: string; in: number; out: number }> = [
    { label: "None", in: 0, out: 0 },
    { label: "Subtle", in: 0.25, out: 0.25 },
    { label: "Smooth", in: 0.5, out: 1.0 },
    { label: "Cinematic", in: 1.0, out: 2.0 },
  ];

  function applyPreset(preset: (typeof FADE_PRESETS)[number]) {
    store.pushUndoState();
    store.updateAudioSettings({ fadeIn: preset.in, fadeOut: preset.out });
  }
  function isPresetActive(preset: (typeof FADE_PRESETS)[number]): boolean {
    const a = store.audioSettings;
    return (
      Math.abs(a.fadeIn - preset.in) < 0.01 &&
      Math.abs(a.fadeOut - preset.out) < 0.01
    );
  }

  // The currently matching preset (if any) drives the Segmented selection;
  // dragging the sliders to a custom value leaves nothing selected.
  const activePreset = $derived(
    FADE_PRESETS.find((p) => isPresetActive(p))?.label ?? "",
  );
  const fadePresetOptions = $derived(
    FADE_PRESETS.map((p) => ({ value: p.label, label: p.label })),
  );

  // SVG path for a tiny gain envelope visualization. Mirrors the FFmpeg
  // afade behaviour: linear ramp 0→1 over fadeIn at the head, hold at 1,
  // then linear ramp 1→0 over fadeOut at the tail.
  function envelopePath(fadeIn: number, fadeOut: number): string {
    const W = 100;
    const H = 24;
    const totalSecs = Math.max(0.01, store.clipDuration || 1);
    const fi = Math.max(0, Math.min(fadeIn, totalSecs * 0.5));
    const fo = Math.max(0, Math.min(fadeOut, totalSecs * 0.5));
    const xIn = (fi / totalSecs) * W;
    const xOut = W - (fo / totalSecs) * W;
    const yTop = 2;
    const yBottom = H - 2;
    return `M 0 ${yBottom} L ${xIn.toFixed(2)} ${yTop} L ${xOut.toFixed(2)} ${yTop} L ${W} ${yBottom}`;
  }

  function formatClipDuration(): string {
    const t = Math.max(0, store.clipDuration || 0);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

<!-- Local, focus-aware: `M` toggles mute (documented in the central shortcut
     registry). `<svelte:window>` so Svelte rebinds it on every HMR patch. -->
<svelte:window onkeydown={handleKey} />

<div
  class="flex flex-col gap-4"
  in:fly={{ y: 8, duration: 260, delay: 40, easing: cubicOut }}
>
  <!-- Output: master gain readout sits directly above the slider that drives it -->
  <PanelSection
    title="Output"
    hint="Volume affects editor playback and export. Press M to toggle mute."
    flush
  >
    {#snippet action()}
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          class="gap-1 text-muted-foreground hover:text-foreground"
          onclick={resetVolume}
          title="Reset volume to 100%"
        >
          <RotateCcw size={11} />
          100%
        </Button>
        <SegmentedToggle
          checked={!store.audioSettings.muted}
          offLabel="Muted"
          onLabel="Live"
          size="xs"
          aria-label="Mute (M)"
          onCheckedChange={(next) => {
            store.pushUndoState();
            store.updateAudioSettings({ muted: !next });
          }}
        />
      </div>
    {/snippet}

    <div class="flex flex-col gap-2.5">
      <!-- Hero meter: gain % + dB + clipping warning + linear gain bar -->
      <div
        class="rounded-md border border-border bg-card/60 px-3 py-2.5"
        class:opacity-50={store.audioSettings.muted}
      >
        <div class="flex items-end justify-between gap-2">
          <div>
            <p class="text-[10px] uppercase tracking-wider text-muted-foreground">
              Output gain
            </p>
            <p
              class="font-mono text-2xl font-medium tabular-nums leading-none {volumeZone ===
              'hot'
                ? 'text-destructive'
                : volumeZone === 'boost'
                  ? 'text-warning'
                  : 'text-foreground'}"
            >
              {store.audioSettings.volume}<span
                class="ml-0.5 text-base text-muted-foreground">%</span
              >
            </p>
            <p
              class="mt-0.5 font-mono text-[10px] tabular-nums {volumeZone === 'hot'
                ? 'text-destructive'
                : volumeZone === 'boost'
                  ? 'text-warning'
                  : 'text-muted-foreground'}"
            >
              {dbForVolume(store.audioSettings.volume)}
            </p>
          </div>
          {#if volumeZone === "boost" || volumeZone === "hot"}
            <span
              in:scale={{ start: 0.85, duration: 220, easing: cubicOut }}
              class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider {volumeZone ===
              'hot'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-warning/40 bg-warning/10 text-warning'}"
            >
              <Waves size={10} />
              {volumeZone === "hot" ? "Clipping risk" : "Boost"}
            </span>
          {/if}
        </div>

        <!-- Linear gain bar with 100% reference mark -->
        <div class="relative mt-2 h-1.5 overflow-hidden rounded-full bg-background">
          <div
            class="absolute inset-y-0 left-0 transition-all duration-300 {volumeZone ===
            'hot'
              ? 'bg-destructive'
              : volumeZone === 'boost'
                ? 'bg-warning'
                : volumeZone === 'low'
                  ? 'bg-success/70'
                  : 'bg-success'}"
            style="width: {Math.min(100, (store.audioSettings.volume / 200) * 100)}%"
          ></div>
          <!-- 100% reference tick -->
          <div
            class="absolute inset-y-0 w-px bg-foreground/40"
            style="left: 50%"
            aria-hidden="true"
          ></div>
        </div>
      </div>

      <!-- The control for the readout above -->
      <SliderControl
        label="Output volume"
        value={store.audioSettings.volume}
        min={0}
        max={200}
        step={5}
        unit="%"
        disabled={store.audioSettings.muted}
        onstart={() => store.pushUndoState()}
        onchange={(next) => store.updateAudioSettings({ volume: next })}
        formatValue={(v) => `${v}%`}
      >
        {#snippet icon()}
          <AudioLines size={11} />
        {/snippet}
      </SliderControl>
    </div>
  </PanelSection>

  <PanelSection
    title="Fades"
    hint="Fades are export-side only — playback stays responsive while you edit."
    flush
    collapsible
  >
    {#snippet action()}
      <span
        class="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
      >
        <AudioWaveform size={10} />
        Envelope
      </span>
    {/snippet}

    <!-- Envelope visualization -->
    <div class="rounded-md border border-border bg-background/60 p-2">
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        class="h-10 w-full"
        aria-hidden="true"
      >
        <path
          d={`${envelopePath(store.audioSettings.fadeIn, store.audioSettings.fadeOut)} L 100 24 L 0 24 Z`}
          class="fill-primary/15"
        />
        <path
          d={envelopePath(store.audioSettings.fadeIn, store.audioSettings.fadeOut)}
          class="stroke-primary/80"
          stroke-width="1.2"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
        <line
          x1="0"
          x2="100"
          y1="2"
          y2="2"
          class="stroke-foreground/15"
          stroke-width="0.5"
          stroke-dasharray="2 2"
        />
      </svg>
      <div
        class="mt-0.5 flex items-center justify-between font-mono text-[9px] tabular-nums text-muted-foreground"
      >
        <span>0:00</span>
        <span>{formatClipDuration()}</span>
      </div>
    </div>

    <!-- Presets -->
    <div class="mt-2">
      <Segmented
        size="xs"
        aria-label="Fade preset"
        value={activePreset}
        options={fadePresetOptions}
        onValueChange={(v) => {
          const preset = FADE_PRESETS.find((p) => p.label === v);
          if (preset) applyPreset(preset);
        }}
      />
    </div>

    <div class="mt-2.5 space-y-2.5">
      <SliderControl
        label="Fade in"
        value={store.audioSettings.fadeIn}
        min={0}
        max={5}
        step={0.05}
        unit="s"
        onstart={() => store.pushUndoState()}
        onchange={(next) => store.updateAudioSettings({ fadeIn: next })}
        formatValue={(v) => `${v.toFixed(2)}s`}
      />
      <SliderControl
        label="Fade out"
        value={store.audioSettings.fadeOut}
        min={0}
        max={5}
        step={0.05}
        unit="s"
        onstart={() => store.pushUndoState()}
        onchange={(next) => store.updateAudioSettings({ fadeOut: next })}
        formatValue={(v) => `${v.toFixed(2)}s`}
      />
    </div>
  </PanelSection>

  <!-- Honest summary of what's in the mix. Per-track gain is not built yet. -->
  <PanelSection
    title="Sources"
    hint="System audio and microphone are captured together and share the master gain. Per-track levels land in the next audio pass."
    flush
  >
    <div
      class="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-2 shadow-(--shadow-craft-inset)"
    >
      <span class="flex items-center gap-1 text-muted-foreground" aria-hidden="true">
        <span class="grid size-6 place-items-center rounded-md bg-muted/60">
          <Speaker size={12} />
        </span>
        <span class="grid size-6 place-items-center rounded-md bg-muted/60">
          <Mic size={12} />
        </span>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-medium text-foreground">
          System audio + microphone
        </p>
        <p class="truncate text-[10px] text-muted-foreground">
          Mixed at master gain · per-track levels coming soon
        </p>
      </div>
    </div>
  </PanelSection>
</div>
