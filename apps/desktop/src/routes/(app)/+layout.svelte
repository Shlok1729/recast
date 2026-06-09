<script lang="ts">
  import { page } from "$app/state";
  import CornerNotifications from "$components/corner-notifications.svelte";
  import AppSidebar from "$components/layout/app-sidebar.svelte";
  import CustomTitlebar from "$components/layout/custom-titlebar.svelte";
  import WindowControls from "$components/layout/window-controls.svelte";
  import WhatsNewDialog from "$components/whats-new-dialog.svelte";
  import { config } from "$constants/app";
  import { layoutMode } from "$lib/stores/layout-mode.svelte";
  import { shortcutsDialog } from "$lib/shortcuts/registry.svelte";
  import { updater } from "$lib/stores/updater.svelte";
  import { whatsNew } from "$lib/stores/whats-new.svelte";
  import { Keyboard } from "@lucide/svelte";
  import * as Sidebar from "@recast/ui/sidebar";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fade } from "svelte/transition";

  let { children } = $props();
  let routeKey = $derived(page.url.pathname);
  let section = $derived(
    routeKey === "/" ? "Home" : routeKey.replace(/^\//, "").split("/")[0]
  );

  // Detected synchronously from the webview UA (same test the shortcuts
  // registry uses) so there's no chrome flash on first paint; false under SSR.
  const isMac =
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

  // Layout chrome preference (Settings → General). `os-native` adapts the
  // window controls per-OS (macOS traffic lights top-left, min/max/close
  // top-right elsewhere) with the inset/flush sidebar; `recast` keeps the
  // classic unified titlebar identical on every OS.
  let osNative = $derived(layoutMode.current === "os-native");
  let sidebarVariant: "sidebar" | "floating" | "inset" = $derived(
    osNative ? (isMac ? "inset" : "sidebar") : "floating"
  );
  let showMacLights = $derived(osNative && isMac);

  onMount(() => {
    // Surface "What's new" once per release (skip if we landed on the changelog
    // already) and kick off the background update check — both non-blocking
    // bottom-right cards.
    if (page.url.pathname.startsWith("/whats-new")) {
      whatsNew.markSeen();
    } else {
      whatsNew.evaluateOnBoot();
    }
    updater.init();
  });
</script>

<Sidebar.Provider class="fixed inset-0 h-full min-h-full">
  <AppSidebar variant={sidebarVariant} {showMacLights} />
  <Sidebar.Inset
    class={["@container/layout", osNative && "overflow-hidden"]}
  >
    {#if osNative}
      <!--
        OS-native chrome. Left: sidebar trigger + breadcrumb, doubling as the
        drag region. Right: keyboard-shortcuts button, then (Windows/Linux only)
        the window controls — on macOS they live in the sidebar (top-left).
      -->
      <header
        data-recast-titlebar
        class="flex h-10 shrink-0 select-none items-center gap-1 border-b border-border/60 px-3"
      >
        <div
          class="flex h-full flex-1 items-center gap-2 font-sans"
          data-tauri-drag-region
        >
          <Sidebar.Trigger
            class="size-7 rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            title="Pin / unpin sidebar (⌘B)"
          />
          <span
            class="pointer-events-none select-none text-[13px] font-semibold tracking-tight text-foreground/80"
            data-tauri-drag-region
          >
            {config.appName}
          </span>
          <span
            class="pointer-events-none select-none text-[11px] font-medium text-muted-foreground/60"
            data-tauri-drag-region
          >
            ·
          </span>
          <span
            class="pointer-events-none select-none truncate text-[11px] font-medium capitalize text-muted-foreground/80"
            data-tauri-drag-region
          >
            {section}
          </span>
          <div class="h-full flex-1" data-tauri-drag-region></div>
        </div>

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

        {#if !isMac}
          <WindowControls kind="win" class="shrink-0" />
        {/if}
      </header>
    {:else}
      <!-- Recast classic: one unified titlebar, identical on every OS. -->
      <CustomTitlebar class="items-center gap-1 px-3">
        <div
          class="flex h-full items-center gap-2 font-sans"
          data-tauri-drag-region
        >
          <div
            in:fade={{ duration: 180, delay: 100, easing: cubicOut }}
            out:fade={{ duration: 140, easing: cubicOut }}
          >
            <Sidebar.Trigger
              class="size-7 rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              title="Pin / unpin sidebar (⌘B)"
            />
          </div>
          <span
            class="pointer-events-none select-none text-[13px] font-semibold tracking-tight text-foreground/80"
            data-tauri-drag-region
          >
            {config.appName}
          </span>
          <span
            class="pointer-events-none select-none text-[11px] font-medium text-muted-foreground/60"
            data-tauri-drag-region
          >
            ·
          </span>
          <span
            class="pointer-events-none select-none truncate text-[11px] font-medium capitalize text-muted-foreground/80"
            data-tauri-drag-region
          >
            {section}
          </span>
        </div>
        <div class="h-full flex-1" data-tauri-drag-region></div>
      </CustomTitlebar>
    {/if}

    <main class="no-scrollbar flex-1 overflow-hidden">
      <div class="h-full">
        {@render children()}
      </div>
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>

<WhatsNewDialog />
<CornerNotifications />
