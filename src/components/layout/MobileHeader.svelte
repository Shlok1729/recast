<script lang="ts">
  import SearchCommandMenu from "$components/layout/SearchCommandMenu.svelte";
  import { Button } from "$components/ui/button";
  import { Trigger as SidebarTrigger } from "$components/ui/sidebar";
  import { Hexagon, Moon, Sun } from "@lucide/svelte";
  import { mode, toggleMode } from "mode-watcher";
</script>

<header
  class="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border/40 bg-card/80 px-4 backdrop-blur-md md:hidden"
>
  <a
    href="/"
    class="group flex items-center gap-3 transition-opacity hover:opacity-80"
  >
    <div
      class="flex h-16 shrink-0 select-none items-center gap-3 px-6"
      data-tauri-drag-region
    >
      <div
        class="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
        data-tauri-drag-region
      >
        <Hexagon size={18} class="fill-current" strokeWidth={2.5} />
      </div>
      <h1
        class="text-base font-semibold tracking-tight group-data-[state=collapsed]:hidden"
        data-tauri-drag-region
      >
        Trace Studio
      </h1>
    </div>
  </a>
  <div class="inline-flex items-center gap-2">
    <SearchCommandMenu iconOnly />
    <Button
      variant="ghost"
      size="icon"
      onclick={toggleMode}
      class="rounded-full"
    >
      {#if mode.current === "light"}
        <Sun size={16} />
      {:else}
        <Moon size={16} />
      {/if}
    </Button>
    <SidebarTrigger />
  </div>
</header>
