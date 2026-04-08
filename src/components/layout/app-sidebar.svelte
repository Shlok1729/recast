<script lang="ts">
  import { page } from "$app/state";
  import SearchCommandMenu from "$components/layout/SearchCommandMenu.svelte";
  import * as Sidebar from "$components/ui/sidebar";
  import { cn } from "$lib/utils";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

  import { Button } from "$components/ui/button";
  import { Download, Film, Hexagon, LayoutDashboard, Radio, Settings, SlidersHorizontal } from "@lucide/svelte";
  import type { ComponentProps } from "svelte";

  let currentPath = $derived(page.url.pathname);
  const navLinks = [
    { title: "Home", href: "/", icon: LayoutDashboard },
    { title: "Recasts", href: "/recasts", icon: Film },
    { title: "Exports", href: "/exports", icon: Download },
    { title: "Profiles", href: "/profiles", icon: SlidersHorizontal },
    { title: "Settings", href: "/settings", icon: Settings },
  ];
  // Helper for active state checking
  function isActive(path: string) {
    return currentPath.endsWith(path);
  }
  async function launchRecordingPanel() {
    const existing = await WebviewWindow.getByLabel("recording-panel");
    if (existing) {
      await existing.setFocus();
      return;
    }

    const panelWidth = 460;
    const panelHeight = 44;
    const panelWin = new WebviewWindow("recording-panel", {
      url: "/panel",
      title: "Recast Panel",
      width: panelWidth,
      height: panelHeight,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      x: Math.round(window.screen.availWidth / 2 - panelWidth / 2),
      y: window.screen.availHeight - panelHeight - 40,
    });

    panelWin.once("tauri://error", (e) => console.error(e));
  }

    let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();
</script>

<Sidebar.Root bind:ref variant="sidebar" {...restProps}>

  <Sidebar.Rail class="data-[state=collapsed]:hidden" />
  <Sidebar.Header>
    <Sidebar.MenuItem>
      <div
        class="inline-flex w-full items-center justify-between gap-2 hover:bg-transparent py-2"
      >
        <a
          href="/"
          class="group flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div
            class="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
            data-tauri-drag-region
          >
            <Hexagon size={18} class="fill-current" strokeWidth={2.5} />
          </div>
          <h1
            class="text-base font-semibold tracking-tight group-data-[state=collapsed]:hidden"
            data-tauri-drag-region
          >
            Recast Studio
          </h1>
        </a>
      </div>
    </Sidebar.MenuItem>

    <Sidebar.MenuItem>
      <SearchCommandMenu />
    </Sidebar.MenuItem>
  </Sidebar.Header>
  <Sidebar.Content class="scrollbar-hide">
    <Sidebar.Group>
      <Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          {#each navLinks as navLink (navLink.href)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton tooltipContent={navLink.title}>
                {#snippet child({ props })}
                  <a
                    href={navLink.href}
                    {...props}
                    class={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 border border-transparent",
                      isActive(navLink.href)
                        ? "bg-dark/10 text-dark border-dark/5 ring-1 ring-dark/5"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      "group-data-[state=collapsed]:p-2 group-data-[state=collapsed]:size-8",
                    )}
                  >
                    {#if navLink.icon}
                      {@const Icon = navLink.icon}
                      <Icon size={16} />
                    {/if}
                    <span class="group-data-[state=collapsed]:hidden"
                      >{navLink.title}</span
                    >
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>

  <Sidebar.Footer
    class="border-t border-border/40 p-4 group-data-[state=collapsed]:hidden"
  >
    <Button onclick={launchRecordingPanel} class="group relative w-full">
      <Radio size={16} class="animate-pulse" />
      Launch Panel
      <div
        class="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/10 to-transparent group-hover:animate-[shimmer_1.5s_infinite]"
      ></div>
    </Button>
  </Sidebar.Footer>
</Sidebar.Root>

<style>
  /* Hide scrollbar for cleaner look */
  .scrollbar-hide {
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
</style>
