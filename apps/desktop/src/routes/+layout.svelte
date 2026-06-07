<script lang="ts">
  import "@fontsource-variable/google-sans";
  import { TooltipProvider } from "@recast/ui/tooltip";
  import "../app.css";
  // RecastPlayer theme — needs to load once globally so any route that
  // mounts <RecastPlayer> (exports preview, future inline players) picks
  // up the branded media-chrome styling.
  import "@recast/player/styles.css";

  import { onNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { launchRecordingPanel } from "$lib/ipc";
  import { openProjectFromExternalPath } from "$lib/openProject";
  import { updater } from "$lib/stores/updater.svelte";

  let { children } = $props();

  // First-run privacy prompt — shown once in the main window only.
  let showFirstRun = $state(false);

  // Analytics + global error capture. Overlay windows (panel, pickers,
  // camera-preview) are skipped — they're transient chrome. The main window
  // owns `app_opened` / identify / the first-run prompt; editor windows still
  // get error capture (gated by the errors-consent flag inside the client).
  onMount(() => {
    if (isTransparentRoute) return;

    let cancelled = false;
    let unlistenAuth: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      if (getCurrentWebviewWindow().label !== "main") return;

      // Hydrate the OS super-property, then record the launch. `app_opened`
      // is a no-op unless the user has opted into product analytics.
      try {
        const { platform } = await import("@tauri-apps/plugin-os");
        analytics.register({ os: platform() });
      } catch {
        // Non-Tauri preview — leave os unset.
      }
      analytics.capture("app_opened");

      if (!desktopConsent.hasSeenFirstRun) showFirstRun = true;

      // Alias anonymous events to the cloud account on sign-in. The payload
      // carries `userId` when the server provides it; otherwise identify is a
      // no-op and only the anonymous install id is tracked.
      const unlisten = await listen<{ userId?: string | null }>(
        "auth:signed-in",
        ({ payload }) => {
          if (payload?.userId) analytics.identify(payload.userId);
          analytics.capture("cloud_connected");
        },
      );
      if (cancelled) unlisten();
      else unlistenAuth = unlisten;
    };
    void setup();

    // Global JS error capture → scrubbed $exception (default-on errors consent).
    const onError = (e: ErrorEvent) =>
      analytics.captureError(e.error ?? e.message, {
        source: "desktop",
        route: page.url.pathname,
      });
    const onRejection = (e: PromiseRejectionEvent) =>
      analytics.captureError(e.reason, {
        source: "desktop",
        route: page.url.pathname,
      });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      cancelled = true;
      unlistenAuth?.();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  });

  import CommandPaletteHost from "$components/layout/CommandPaletteHost.svelte";
  import ShortcutsDialog from "$components/layout/ShortcutsDialog.svelte";
  import { dispatchShortcut } from "$lib/shortcuts/registry.svelte";
  import FirstRunConsent from "$components/FirstRunConsent.svelte";
  import { analytics } from "$lib/analytics/client";
  import { desktopConsent } from "$lib/stores/consent.svelte";
  import { initAssets } from "$lib/assets";
  import { initExtensions } from "$lib/extensions";
  import { NavProgress } from "@recast/ui/nav-progress";
  import { getTauriTheme, isTauriApp } from "$lib/runtime/tauri";
  import { Toaster, toast } from "@recast/ui/sonner";
  import { ModeWatcher, setMode } from "@recast/ui/theme";
  import { safeStorage } from "@recast/ui/persisted-state";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, tick } from "svelte";
  import { log } from "$lib/logger";

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
      // own listener will stop the in-flight recording, and we deliberately
      // do nothing here so we don't steal focus mid-stop. We only handle
      // the "start from cold" path: open /panel in its own window (or
      // focus it if it's already there). The panel restores the last
      // source on mount, so no source-picker detour is needed.
      //
      // Label must stay in sync with `launchRecordingPanel()` in ipc.ts.
      const { getAllWebviewWindows } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const all = await getAllWebviewWindows();
      const hasPanel = all.some((w) => w.label === "recording-panel");
      if (hasPanel) return;
      void launchRecordingPanel();
    });
    const offCheckUpdates = listen("updater:check-from-tray", () => {
      void updater.checkNow();
    });
    return () => {
      void offToggle.then((fn) => fn());
      void offCheckUpdates.then((fn) => fn());
    };
  });

  // OS file-association bridge. Two paths in:
  //
  //   * Cold start — the user double-clicked a .recast while the app was
  //     not running. Rust parses argv in setup() and stashes the path in
  //     AppState; we drain it once on mount via `take_pending_open_file`.
  //   * Warm start — the user double-clicked while the app was already
  //     running. tauri-plugin-single-instance forwards the ghost process's
  //     argv to the running instance, which emits `app://open-recast`.
  //     Close-to-tray keeps this listener alive even when main is hidden.
  //
  // Both paths funnel through openProjectFromExternalPath, which validates
  // the file (metadata.json must parse), refuses while recording, and
  // always spawns a fresh editor window — never navigates main, so the
  // user's library view and any unsaved editor state stay put.
  //
  // Gated on `!isTransparentRoute` so secondary windows (panel, pickers,
  // camera-preview) don't double-subscribe and race to spawn the window.
  // Editor secondary windows aren't in TRANSPARENT_ROUTES but they're
  // labelled `editor-*` rather than `main` — see the label check below.
  onMount(() => {
    if (isTransparentRoute) return;
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      if (getCurrentWebviewWindow().label !== "main") return;

      try {
        const pending = await invoke<string | null>(
          "take_pending_open_file",
        );
        if (!cancelled && pending) {
          void openProjectFromExternalPath(pending);
        }
      } catch (e) {
        console.warn("[open-recast] cold-start drain failed", e);
      }

      const unlistenPromise = listen<string>(
        "app://open-recast",
        ({ payload }) => {
          if (!payload) return;
          void openProjectFromExternalPath(payload);
        },
      );
      unlistenPromise.then((fn) => {
        if (cancelled) fn();
        else unlistenFn = fn;
      });
    };

    void setup();

    return () => {
      cancelled = true;
      unlistenFn?.();
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
  // Hydrate installed asset-pack extensions and register their contributions.
  initExtensions();

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
      // Read-only — mode-watcher owns this key; we just defer to the OS theme
      // when the user hasn't explicitly picked light/dark.
      const stored = safeStorage.get<string>("mode-watcher-mode", "");
      if (theme && (!stored || stored === "system")) {
        setMode(theme);
      }
    }
  });

  // Diagnostic: record the TRUE fields of every modifier-involved keydown so a
  // "phantom shortcut" report (e.g. "Ctrl alone toggles the sidebar") can be
  // traced to the actual event. One Svelte-managed listener, gated through
  // `log.debug` (emits only in dev or when Diagnostic logging is on), so it's
  // silent in a normal release build. Plain typing is skipped to keep it
  // readable. Reading guide: if a panel opens on a keydown whose logged `key`
  // is "Control"/"Meta" (a bare modifier), the action came from a STALE
  // listener running OLD code — a classic dev-server HMR leak — and a full
  // `pnpm tauri dev` restart clears it. If you instead see the SAME keydown
  // logged twice per physical press, listeners are accumulating.
  function logKeyDiagnostic(e: KeyboardEvent) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) return;
    const t = e.target as HTMLElement | null;
    log.debug("input", "keydown", {
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
      repeat: e.repeat,
      target: t?.tagName?.toLowerCase() ?? null,
      route: page.url.pathname,
    });
  }

  // Hard stop for "phantom shortcut" triggers. A modifier key pressed ALONE
  // (Ctrl / Cmd / Shift / Alt with no other key) is never a shortcut, yet a
  // stale listener left on `window` by a dev-server hot-reload can still act on
  // it (the "bare Ctrl toggles the sidebar / palette" ghost). We swallow the
  // lone-modifier keydown in the CAPTURE phase — which runs before every
  // bubble-phase listener, ghosts included — so nothing downstream ever sees
  // it. Harmless in production (nothing should react to a lone modifier);
  // decisive against HMR ghosts in dev. A real combo like Ctrl+B is untouched:
  // its keydown carries `key === "b"`, not a bare modifier, so it propagates
  // normally. Registered via `$effect` so HMR re-establishes it on every patch.
  const BARE_MODIFIER_KEYS = new Set([
    "Control",
    "Shift",
    "Alt",
    "Meta",
    "OS",
    "AltGraph",
  ]);
  $effect(() => {
    const swallowBareModifier = (e: KeyboardEvent) => {
      if (BARE_MODIFIER_KEYS.has(e.key)) e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", swallowBareModifier, { capture: true });
    return () =>
      window.removeEventListener("keydown", swallowBareModifier, {
        capture: true,
      });
  });
</script>

<!-- One window keydown hook (Svelte allows only one): diagnostics first, then
     the central shortcut dispatcher. The dispatcher is skipped on the small
     overlay windows, which own their own minimal key handling. -->
<svelte:window
  onkeydown={(e) => {
    logKeyDiagnostic(e);
    if (!isTransparentRoute) dispatchShortcut(e);
  }}
/>

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
    <!-- Global keyboard-shortcut reference (opened from the titlebar or Mod+/). -->
    <ShortcutsDialog />
  {/if}
  <div
    class="relative flex min-h-screen min-w-dvw w-full flex-col {isTransparentRoute
      ? 'bg-transparent'
      : 'bg-background'}"
  >
    {@render children()}
  </div>
  {#if showFirstRun}
    <FirstRunConsent onclose={() => (showFirstRun = false)} />
  {/if}
</TooltipProvider>
