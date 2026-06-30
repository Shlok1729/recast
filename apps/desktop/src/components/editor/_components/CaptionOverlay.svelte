<script lang="ts">
  // Live caption overlay over the preview. Reads the generated transcript +
  // style from the store and renders the segment active at `currentTime`.
  // Sits inside `previewRectEl`, so `cqh` font sizing tracks the preview size.
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { ensureFontLoaded } from "$lib/fonts/font-options";

  let { store }: { store: EditorStore } = $props();

  // Fetch + register the selected Google font (idempotent) so the preview
  // renders it — covers picker changes and reloading a saved project.
  $effect(() => {
    ensureFontLoaded(store.captionStyle.fontFamily, store.captionStyle.fontWeight);
  });

  /** Hex (#rrggbb) + 0–100 opacity → an rgba() string. */
  function rgba(hex: string, opacity: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
  }

  const active = $derived.by(() => {
    const t = store.transcript;
    if (!t || !store.captionStyle.enabled) return null;
    const now = store.currentTime;
    return t.segments.find((s) => now >= s.start && now < s.end) ?? null;
  });
</script>

{#if active}
  {@const s = store.captionStyle}
  <div
    class="caption-layer pointer-events-none absolute inset-0 flex px-[6%]"
    class:items-end={s.position === "bottom"}
    class:items-center={s.position === "center"}
    class:items-start={s.position === "top"}
    class:justify-start={s.align === "left"}
    class:justify-center={s.align === "center"}
    class:justify-end={s.align === "right"}
  >
    <span
      class="caption-text leading-tight"
      class:text-left={s.align === "left"}
      class:text-center={s.align === "center"}
      class:text-right={s.align === "right"}
      class:cap-soft={s.background === "soft"}
      class:cap-box={s.background === "box"}
      style="color: {s.color}; font-size: {s.fontSizePct}cqh;
        font-family: {s.fontFamily}; font-weight: {s.fontWeight};
        letter-spacing: {s.letterSpacing}em;
        text-transform: {s.uppercase ? 'uppercase' : 'none'};
        margin-top: {s.position === 'top' ? `${s.offsetPct}%` : '0'};
        margin-bottom: {s.position === 'bottom' ? `${s.offsetPct}%` : '0'};
        {s.outlineWidth > 0
          ? `-webkit-text-stroke: ${s.outlineWidth / 100}em ${s.outlineColor}; paint-order: stroke fill;`
          : ''}
        {s.background === 'box' ? `background: ${rgba(s.backgroundColor, s.backgroundOpacity)};` : ''}
        --lines: {s.maxLines};"
    >
      {active.text}
    </span>
  </div>
{/if}

<style>
  /* Establish a size container so the text's `cqh` font scales with the
     preview rectangle (which this layer fills). */
  .caption-layer {
    container-type: size;
  }
  .caption-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--lines, 2);
    line-clamp: var(--lines, 2);
    overflow: hidden;
    max-width: 92%;
    text-wrap: balance;
  }
  .cap-soft {
    text-shadow:
      0 1px 2px rgba(0, 0, 0, 0.9),
      0 0 6px rgba(0, 0, 0, 0.7);
  }
  .cap-box {
    padding: 0.15em 0.55em;
    border-radius: 0.28em;
  }
</style>
