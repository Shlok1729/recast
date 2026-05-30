<script lang="ts" module>
  export type ExportFlowPhase =
    | "options"
    | "progress"
    | "success"
    | "cancelled"
    | "error";
</script>

<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { fade, scale } from "svelte/transition";

  interface Props {
    open: boolean;
    phase: ExportFlowPhase | null;
    onEscape?: () => void;
    onBackdropClick?: () => void;
    options?: Snippet;
    progress?: Snippet;
    success?: Snippet;
    cancelled?: Snippet;
    error?: Snippet;
  }

  let {
    open,
    phase,
    onEscape,
    onBackdropClick,
    options,
    progress,
    success,
    cancelled,
    error,
  }: Props = $props();

  // Body is sized intrinsically; the outer dialog Tweens its width + height to
  // match what the body reports via ResizeObserver. This way each phase body
  // declares its natural size and the wrapper just follows — no per-phase
  // hardcoded dimensions that drift as the bodies evolve.
  let bodyEl = $state<HTMLDivElement | null>(null);
  let measuredW = $state(440);
  let measuredH = $state(0);

  const wTween = new Tween(440, { duration: 320, easing: cubicOut });
  const hTween = new Tween(0, { duration: 320, easing: cubicOut });

  // Track first measurement per open-cycle so we can snap to the initial size
  // instead of growing from zero (which would fight the scale-in entrance).
  let snapNext = $state(true);
  $effect(() => {
    if (!open) snapNext = true;
  });

  $effect(() => {
    if (!bodyEl) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Round to integer to avoid sub-pixel jitter retriggering the Tween.
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0) measuredW = w;
      if (h > 0) measuredH = h;
    });
    ro.observe(bodyEl);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (measuredW <= 0 || measuredH <= 0) return;
    if (snapNext) {
      wTween.set(measuredW, { duration: 0 });
      hTween.set(measuredH, { duration: 0 });
      snapNext = false;
    } else {
      wTween.target = measuredW;
      hTween.target = measuredH;
    }
  });

  let dialogRef = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (open) {
      tick().then(() => dialogRef?.focus());
    }
  });

  // Re-focus on phase change so screen-readers re-announce + keyboard focus
  // stays inside the dialog as content swaps under the user.
  $effect(() => {
    phase;
    if (open) tick().then(() => dialogRef?.focus());
  });

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode === document.body) {
          document.body.removeChild(node);
        }
      },
    };
  }

  // Custom out-transition that absolute-positions the leaving phase so it
  // doesn't keep pushing the body's measured size while it fades. The new
  // phase mounts in normal flow → ResizeObserver picks up its natural size
  // → Tween animates the wrapper to match concurrent with the fade.
  function phaseOut(node: HTMLElement) {
    const parent = node.parentElement;
    if (parent) {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      node.style.position = "absolute";
      node.style.inset = "0";
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
    }
    return {
      duration: 160,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t};`,
    };
  }
</script>

{#if open}
  <div
    use:portal
    class="fixed inset-0 z-100 flex items-start justify-center bg-background/60 px-4 pt-[8vh] backdrop-blur-sm sm:pt-[10vh]"
    role="presentation"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) onBackdropClick?.();
    }}
    in:fade={{ duration: 140 }}
    out:fade={{ duration: 110 }}
  >
    <div
      bind:this={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-flow-title"
      onkeydown={handleKeydown}
      tabindex="-1"
      in:scale={{ duration: 220, start: 0.96, easing: cubicOut }}
      out:scale={{ duration: 140, start: 0.97 }}
      style="width: {wTween.current}px; height: {hTween.current || measuredH || 0}px; max-width: min(820px, calc(100vw - 2rem)); max-height: calc(100vh - 4rem);"
      class="relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-popover/95 shadow-2xl ring-1 ring-border/40 backdrop-blur-xl focus:outline-none"
    >
      <!--
        Body wrap is `position: relative` so the leaving phase can pin itself
        with `position: absolute` during its fade-out. The active phase sits
        in normal flow; ResizeObserver measures its natural size and the
        wrapper morphs to match.
      -->
      <div bind:this={bodyEl} class="relative w-fit min-w-[280px]">
        {#key phase}
          <div
            class="flex flex-col"
            in:fade={{ duration: 220, delay: 160, easing: cubicOut }}
            out:phaseOut
          >
            {#if phase === "options"}
              {@render options?.()}
            {:else if phase === "progress"}
              {@render progress?.()}
            {:else if phase === "success"}
              {@render success?.()}
            {:else if phase === "cancelled"}
              {@render cancelled?.()}
            {:else if phase === "error"}
              {@render error?.()}
            {/if}
          </div>
        {/key}
      </div>
    </div>
  </div>
{/if}
