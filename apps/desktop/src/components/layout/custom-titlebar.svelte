<script lang="ts">
  import WindowControls from "$components/layout/window-controls.svelte";
  import { shortcutsDialog } from "$lib/shortcuts/registry.svelte";
  import { layoutMode } from "$lib/stores/layout-mode.svelte";
  import { Keyboard } from "@lucide/svelte";
  import { cn } from "@recast/ui/utils";
  import { platform } from "@tauri-apps/plugin-os";
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
    class?: string;
    wrapperClass?: string;
  }

  let { children, class: className, wrapperClass }: Props = $props();

  // Detected synchronously from the webview UA (same test the shortcuts
  // registry and the `(app)` shell use) so there's no chrome flash on first
  // paint; false under SSR.
  const isMac = ["darwin", "ios"].includes(platform());
  // Mirror the `(app)` shell's chrome modes so the editor titlebar follows the
  // same preference. `os-native` follows the OS — macOS traffic lights lead the
  // bar on the left, min/max/close sit on the right for Windows/Linux. `recast`
  // keeps the unified min/max/close cluster on the right, identical on every OS.
  const macLights = $derived(layoutMode.current === "os-native" && isMac);
</script>

<div
  data-recast-titlebar
  class={cn(
    "group h-10 flex items-center gap-1 border-b border-border/60 bg-background/70 backdrop-blur-xl shrink-0 select-none px-1 py-1 transition-all duration-300",
    wrapperClass,
  )}
>
  <!-- macOS · os-native: traffic lights lead the bar, before the content. -->
  {#if macLights}
    <WindowControls kind="mac" class="px-1.5" />
  {/if}

  <!-- Drag region: only the content area, not the window controls -->
  <div
    class={cn("flex-1 flex items-center min-w-0 h-full font-sans", className)}
    data-tauri-drag-region
  >
    {#if children}
      {@render children()}
    {/if}
  </div>

  <!-- Keyboard-shortcuts reference. Outside the drag region so the click
       registers; sits just left of the window controls on every main window. -->
  <button
    type="button"
    onclick={() => shortcutsDialog.show()}
    onmousedown={(e) => e.stopPropagation()}
    aria-label="Keyboard shortcuts"
    title="Keyboard shortcuts (Ctrl + /)"
    class="group inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-card hover:text-foreground"
  >
    <Keyboard size={15} />
  </button>

  <!-- Windows/Linux (and recast mode on every OS): min/max/close on the right.
       Outside the drag region so clicks aren't intercepted. -->
  {#if !macLights}
    <WindowControls kind="win" class="shrink-0" />
  {/if}
</div>
