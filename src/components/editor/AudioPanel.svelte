<script lang="ts">
  import { Button } from "$components/ui/button";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { AudioLines, Volume2, VolumeX } from "@lucide/svelte";
  import InspectorHint from "./InspectorHint.svelte";
  import SliderControl from "./SliderControl.svelte";

  interface Props {
    store: EditorStore;
  }

  let { store }: Props = $props();

  function updateAudioSettings(
    updates: Partial<EditorStore["audioSettings"]>,
    trackUndo = false,
  ) {
    if (trackUndo) store.pushUndoState();
    store.updateAudioSettings(updates);
  }
</script>

<div class="flex flex-col gap-5 animate-in fade-in duration-200">
  <!-- Header + mute toggle -->
  <section>
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Audio
        </h3>
        <InspectorHint content="Volume affects editor playback and export. Fades are applied during export." />
      </div>
      <Button
        variant={store.audioSettings.muted ? "destructive_soft" : "default_soft"}
        size="xs"
        class="gap-1.5"
        onclick={() => updateAudioSettings({ muted: !store.audioSettings.muted }, true)}
        aria-pressed={store.audioSettings.muted}
      >
        {#if store.audioSettings.muted}
          <VolumeX size={11} />
          Muted
        {:else}
          <Volume2 size={11} />
          Live
        {/if}
      </Button>
    </div>

    <!-- Stat strip: current values at a glance -->
    <div class="mt-2 grid grid-cols-3 gap-1 text-[10px]">
      <div class="rounded-md border border-border bg-background/60 px-2 py-1.5">
        <p class="uppercase tracking-wider text-muted-foreground">Vol</p>
        <p class="mt-0.5 font-mono tabular-nums text-foreground">
          {store.audioSettings.volume}%
        </p>
      </div>
      <div class="rounded-md border border-border bg-background/60 px-2 py-1.5">
        <p class="uppercase tracking-wider text-muted-foreground">Fade in</p>
        <p class="mt-0.5 font-mono tabular-nums text-foreground">
          {store.audioSettings.fadeIn.toFixed(2)}s
        </p>
      </div>
      <div class="rounded-md border border-border bg-background/60 px-2 py-1.5">
        <p class="uppercase tracking-wider text-muted-foreground">Fade out</p>
        <p class="mt-0.5 font-mono tabular-nums text-foreground">
          {store.audioSettings.fadeOut.toFixed(2)}s
        </p>
      </div>
    </div>
  </section>

  <!-- Mix section -->
  <section>
    <header class="mb-2 flex items-center gap-1.5">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Mix
      </h3>
      <InspectorHint content="Mute preserves the chosen volume level so you can toggle it back on quickly." />
    </header>

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
  </section>

  <!-- Fades section -->
  <section>
    <header class="mb-2 flex items-center gap-1.5">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Fades
      </h3>
      <InspectorHint content="Fades are export-side only, so playback remains responsive while you edit." />
    </header>

    <div class="space-y-2.5">
      <SliderControl
        label="Fade in"
        value={store.audioSettings.fadeIn}
        min={0}
        max={5}
        step={0.25}
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
        step={0.25}
        unit="s"
        onstart={() => store.pushUndoState()}
        onchange={(next) => store.updateAudioSettings({ fadeOut: next })}
        formatValue={(v) => `${v.toFixed(2)}s`}
      />
    </div>
  </section>
</div>
