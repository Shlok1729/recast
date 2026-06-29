<script lang="ts">
  // Live caption overlay over the preview. Reads the generated transcript +
  // style from the store and renders the segment active at `currentTime`.
  // Sits inside `previewRectEl`, so `cqh` font sizing tracks the preview size.
  import type { EditorStore } from "$lib/stores/editor-store.svelte";

  let { store }: { store: EditorStore } = $props();

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
    class="caption-layer pointer-events-none absolute inset-0 flex justify-center px-[6%]"
    class:items-end={s.position === "bottom"}
    class:items-center={s.position === "center"}
    class:items-start={s.position === "top"}
  >
    <span
      class="caption-text text-center leading-tight"
      class:cap-soft={s.background === "soft"}
      class:cap-box={s.background === "box"}
      style="color: {s.color}; font-size: {s.fontSizePct}cqh;
        font-family: {s.fontFamily}; font-weight: {s.fontWeight};
        margin-top: {s.position === 'top' ? '6%' : '0'};
        margin-bottom: {s.position === 'bottom' ? '6%' : '0'};
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
    background: rgba(0, 0, 0, 0.65);
    padding: 0.15em 0.55em;
    border-radius: 0.28em;
  }
</style>
