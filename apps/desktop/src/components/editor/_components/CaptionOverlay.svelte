<script lang="ts">
  // Live caption overlay over the preview. Reads the generated transcript +
  // style from the store and renders the segment active at the playhead. When
  // the style carries an animation it renders word-by-word (chunking + active-
  // word emphasis + entrance); otherwise it renders the whole line, unchanged.
  // Sits inside `previewRectEl`, so `cqh` font sizing tracks the preview size.
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { ensureFontLoaded } from "$lib/fonts/font-options";
  import { outputToOriginal } from "$lib/timeline/time-map";
  import {
    activeChunkIndex,
    activeWordIndex,
    chunkWords,
    isStaticAnimation,
    resolveCaptionAnimation,
  } from "$lib/captions/animation";

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

  // The playhead is OUTPUT time; the transcript is SOURCE time. Map back through
  // the time map so captions (and per-word timing) stay synced across cuts and
  // per-segment speed changes.
  const nowOrig = $derived(outputToOriginal(store.timeMap, store.currentTime));

  const active = $derived.by(() => {
    const t = store.transcript;
    if (!t || !store.captionStyle.enabled) return null;
    return t.segments.find((s) => nowOrig >= s.start && nowOrig < s.end) ?? null;
  });

  const anim = $derived(resolveCaptionAnimation(store.captionStyle.animation));
  const animated = $derived(!!active && active.words.length > 0 && !isStaticAnimation(anim));

  // The chunk + active word to show, or null when rendering the static line.
  const view = $derived.by(() => {
    if (!active || !animated) return null;
    const runs = chunkWords(active.words, anim);
    const ci = activeChunkIndex(runs, nowOrig);
    const chunk = runs[ci];
    if (!chunk) return null;
    const wi = activeWordIndex(chunk.words, nowOrig, anim.holdGaps);
    // `key` re-mounts the line when the chunk changes, re-running the entrance.
    return { key: `${active.id}:${ci}`, words: chunk.words, wi };
  });

  // Shared text styles for the line element (static and animated alike).
  const textStyle = $derived.by(() => {
    const s = store.captionStyle;
    return [
      `color: ${s.color}`,
      `font-size: ${s.fontSizePct}cqh`,
      `font-family: ${s.fontFamily}`,
      `font-weight: ${s.fontWeight}`,
      `letter-spacing: ${s.letterSpacing}em`,
      `text-transform: ${s.uppercase ? "uppercase" : "none"}`,
      `margin-top: ${s.position === "top" ? `${s.offsetPct}%` : "0"}`,
      `margin-bottom: ${s.position === "bottom" ? `${s.offsetPct}%` : "0"}`,
      s.outlineWidth > 0
        ? `-webkit-text-stroke: ${s.outlineWidth / 100}em ${s.outlineColor}; paint-order: stroke fill`
        : "",
      s.background === "box" ? `background: ${rgba(s.backgroundColor, s.backgroundOpacity)}` : "",
      `--lines: ${s.maxLines}`,
    ]
      .filter(Boolean)
      .join("; ");
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
    {#if animated && view}
      {#key view.key}
        <span
          class="caption-text leading-tight entrance-{anim.entrance}"
          class:text-left={s.align === "left"}
          class:text-center={s.align === "center"}
          class:text-right={s.align === "right"}
          class:cap-soft={s.background === "soft"}
          class:cap-box={s.background === "box"}
          style="{textStyle}; --entrance-ms: {anim.entranceMs}ms;"
        >
          {#each view.words as word, i (i)}
            {#if i > 0}{" "}{/if}<span
              class="word"
              class:em-scale={anim.emphasis === "scale" && i === view.wi && view.words.length > 1}
              style={anim.emphasis === "color" && i === view.wi
                ? `color: ${anim.emphasisColor}`
                : ""}>{word.text}</span
            >
          {/each}
        </span>
      {/key}
    {:else}
      <span
        class="caption-text leading-tight"
        class:text-left={s.align === "left"}
        class:text-center={s.align === "center"}
        class:text-right={s.align === "right"}
        class:cap-soft={s.background === "soft"}
        class:cap-box={s.background === "box"}
        style={textStyle}
      >
        {active.text}
      </span>
    {/if}
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
  /* Active-word emphasis: a quick, eased transition so the highlight tracks
     speech without snapping. Colour emphasis is applied inline (dynamic hex). */
  .word {
    transition:
      color 120ms ease,
      transform 120ms ease;
  }
  .em-scale {
    display: inline-block;
    transform: scale(1.14);
  }
  /* Per-chunk entrance — the keyed line re-mounts on chunk change, re-running
     these. `none` has no rule (renders instantly). */
  .entrance-fade {
    animation: cap-fade var(--entrance-ms, 220ms) ease-out both;
  }
  .entrance-pop {
    animation: cap-pop var(--entrance-ms, 220ms) cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
  }
  .entrance-slide {
    animation: cap-slide var(--entrance-ms, 220ms) ease-out both;
  }
  @keyframes cap-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes cap-pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  @keyframes cap-slide {
    from {
      opacity: 0;
      transform: translateY(0.35em);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .entrance-fade,
    .entrance-pop,
    .entrance-slide {
      animation: none;
    }
    .word {
      transition: none;
    }
  }
</style>
