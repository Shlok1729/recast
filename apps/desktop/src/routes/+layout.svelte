<script lang="ts">
  import "@fontsource-variable/google-sans";
  import { TooltipProvider } from "@recast/ui/tooltip";
  import "../app.css";
  // RecastPlayer theme — needs to load once globally so any route that
  // mounts <RecastPlayer> (exports preview, future inline players) picks
  // up the branded media-chrome styling.
  import "@recast/player/styles.css";

  import { goto, onNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { updater } from "$lib/stores/updater.svelte";

  let { children } = $props();

  import CommandPaletteHost from "$components/layout/CommandPaletteHost.svelte";
  import { initAssets } from "$lib/assets";
  import { NavProgress } from "@recast/ui/nav-progress";
  import { getTauriTheme, isTauriApp } from "$lib/runtime/tauri";
  import { Toaster, toast } from "@recast/ui/sonner";
  import { ModeWatcher, setMode } from "@recast/ui/theme";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, tick } from "svelte";

  const TRANSPARENT_ROUTES = [
    "/camera-preview",
    "/device-picker",
    "/profile-picker",
    "/select",
    "/panel",
  ];
  const isTransparentRoute = $derived(
    TRANSPARENT_ROUTES.some((p) => page.url.pathname.startsWith(p)),
  );

  // Cross-window toast bridge. The floating panel / camera-preview /
  // picker windows are too narrow to host a 320px Sonner card themselves
  // (they're in `TRANSPARENT_ROUTES` and don't render their own Toaster).
  // They emit `ui:toast` events and we render them through the main
  // window's Toaster instead. Keeps the in-window panel UI chrome-free
  // while still giving users a polished notification language instead
  // of the OS native alert popup.
  type UiToastPayload = {
    level: "error" | "warning" | "info" | "success";
    message: string;
    duration?: number;
  };
  onMount(() => {
    if (isTransparentRoute) return;
    const unlisten = listen<UiToastPayload>("ui:toast", ({ payload }) => {
      const opts = payload.duration ? { duration: payload.duration } : undefined;
      switch (payload.level) {
        case "error":
          toast.error(payload.message, opts);
          break;
        case "warning":
          toast.warning(payload.message, opts);
          break;
        case "success":
          toast.success(payload.message, opts);
          break;
        default:
          toast.info(payload.message, opts);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  // System-tray bridge. The tray icon emits high-level intent events that
  // only make sense in the main window (the recording panel and overlay
  // routes each have their own scoped listeners for tray actions that
  // belong to them — e.g. panel listens for `tray:record-toggle` to stop
  // an in-flight recording). Main-window handlers cover the cases where
  // no recording is active: jump straight to the source picker for
  // "Start Recording", run an updater check for "Check for Updates…".
  onMount(() => {
    if (isTransparentRoute) return;
    const offToggle = listen("tray:record-toggle", async () => {
      // If a recording panel is already open, it owns the toggle — its
      // own listener will stop the recording. We only handle the
      // "start from cold" path here.
      const { getAllWebviewWindows } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const all = await getAllWebviewWindows();
      const hasPanel = all.some((w) => w.label === "panel");
      if (hasPanel) return;
      void goto("/select");
    });
    const offCheckUpdates = listen("updater:check-from-tray", () => {
      void updater.checkNow();
    });
    return () => {
      void offToggle.then((fn) => fn());
      void offCheckUpdates.then((fn) => fn());
    };
  });

  // Native macOS-style page transitions via the View Transitions API.
  // Skipped for overlay/secondary windows (transparent routes) and when the
  // user prefers reduced motion — CSS handles the reduced-motion case too.
  onNavigate((navigation) => {
    if (typeof document === "undefined") return;
    if (!("startViewTransition" in document)) return;

    const to = navigation.to?.url.pathname ?? "";
    const from = navigation.from?.url.pathname ?? "";
    const isOverlay = (p: string) =>
      TRANSPARENT_ROUTES.some((r) => p.startsWith(r));
    if (isOverlay(to) || isOverlay(from)) return;

    document.documentElement.dataset.navDirection =
      to.length >= from.length ? "forward" : "back";

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  // Kick off external-asset download (wallpapers etc.) on first paint. Safe in
  // both browser and Tauri runtimes — no-op in the browser.
  initAssets();

  // Remove the boot splash screen after the app is mounted
  onMount(async () => {
    await tick();
    const boot = document.getElementById("boot");
    if (boot) {
      boot.classList.add("boot-leaving");
      setTimeout(() => boot.remove(), 280);
    }

    if (await isTauriApp()) {
      const theme = await getTauriTheme();
      const stored = localStorage.getItem("mode-watcher-mode");
      if (theme && (!stored || stored === "system")) {
        setMode(theme);
      }
    }
  });
</script>
<TooltipProvider>
  <NavProgress />
  <ModeWatcher />
  <!-- Overlay windows (panel, camera-preview, pickers) are too small to host
       a Sonner toast without overflow. Gate the Toaster out of those routes so
       downstream code that calls `toast.*` is just a no-op there — the main
       window keeps its toaster as usual. -->
  {#if !isTransparentRoute}
    <!-- Position/styling defaults live in @recast/ui/sonner so every
         consumer (desktop, web) gets the same bottom-right glass-card
         notification language matching the auto-updater stack. Override
         here only if a specific route needs a different placement. -->
    <Toaster />
    <!-- Command palette host: owns the ⌘K shortcut + dialog so they work on
         every route (editor included), not just the (app) sidebar layout. -->
    <CommandPaletteHost />
  {/if}
  <div
    class="relative flex min-h-screen min-w-dvw w-full flex-col {isTransparentRoute
      ? 'bg-transparent'
      : 'bg-background'}"
  >
    {@render children()}
  </div>
</TooltipProvider>
