<script lang="ts">
  import Logo from "$components/logo.svelte";
  import CloudEndpoint from "$components/settings/CloudEndpoint.svelte";
  import CloudSignIn from "$components/settings/CloudSignIn.svelte";
  import DeviceCapabilities from "$components/settings/DeviceCapabilities.svelte";
  import DiagnosticsPanel from "$components/settings/DiagnosticsPanel.svelte";
  import GoogleDriveConnection from "$components/settings/GoogleDriveConnection.svelte";
  import { config } from "$constants/app";
  import { getOutputDir, setOutputDir } from "$lib/ipc";
  import {
    ArrowUpRight,
    Cloud,
    Cpu,
    ExternalLink,
    FlaskConical,
    FolderOpen,
    Github,
    Globe,
    HardDrive,
    Info,
    Monitor,
    Moon,
    Navigation,
    PanelsTopLeft,
    Server,
    Settings as SettingsIcon,
    Shield,
    SlidersHorizontal as SlidersIcon,
    Sparkles,
    Sun,
    Timer,
    Video,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { toast } from "@recast/ui/sonner";
  import * as Tabs from "@recast/ui/tabs";
  import { setMode } from "@recast/ui/theme";
  import { cn } from "@recast/ui/utils";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  import { syncConsent } from "$lib/analytics/client";
  import { desktopConsent } from "$lib/stores/consent.svelte";
  import {
    FLAG_META,
    experimentalStore,
    type ExperimentalFlag,
  } from "$lib/stores/experimental.svelte";
  import {
    LAYOUT_MODES,
    layoutMode,
    type LayoutMode,
  } from "$lib/stores/layout-mode.svelte";
  import { profilesStore } from "$lib/stores/profiles.svelte";
  import {
    recordingCountdown,
    type CountdownSeconds,
  } from "$lib/stores/recording-countdown.svelte";
  import { safeStorage } from "@recast/ui/persisted-state";

  type Theme = "light" | "dark" | "system";
  type EditorBehavior = "navigate" | "new-window";
  type SettingsTab =
    | "general"
    | "recording"
    | "cloud"
    | "experimental"
    | "about";

  let outputDir = $state("");
  let currentTheme = $state<Theme>("system");
  let editorWindow = $state<EditorBehavior>("navigate");
  let countdown = $state<CountdownSeconds>(3);
  let closeToTray = $state(true);
  // Land on Recording — the daily-use panel (output directory, profiles,
  // editor behavior) — rather than the leftmost General tab, matching how
  // people actually reach for these settings.
  let activeTab = $state<SettingsTab>("recording");

  onMount(() => {
    fetchSettings();
    profilesStore.hydrate();
    // `mode-watcher-mode` is owned by the mode-watcher library — we only read
    // it here to reflect the current choice in the radio group.
    currentTheme = safeStorage.get<Theme>("mode-watcher-mode", currentTheme);
    editorWindow = safeStorage.get<EditorBehavior>(
      "recast-editor-window",
      editorWindow,
    );
    countdown = recordingCountdown.value;
  });

  function toggleProfilesEnabled() {
    const next = !profilesStore.enabled;
    profilesStore.setEnabled(next);
    toast.success(
      next ? "Profiles enabled" : "Profiles disabled",
    );
  }

  function toggleExperimental(key: ExperimentalFlag, label: string) {
    const next = !experimentalStore.isEnabled(key);
    experimentalStore.setEnabled(key, next);
    toast.success(next ? `${label} enabled` : `${label} disabled`);
  }

  function toggleProductAnalytics() {
    const next = !desktopConsent.product;
    desktopConsent.setProduct(next);
    syncConsent();
    toast.success(next ? "Usage analytics enabled" : "Usage analytics disabled");
  }

  function toggleCrashReports() {
    const next = !desktopConsent.errors;
    desktopConsent.setErrors(next);
    syncConsent();
    toast.success(next ? "Crash reports enabled" : "Crash reports disabled");
  }

  async function fetchSettings() {
    try {
      outputDir = await getOutputDir();
    } catch (e) {
      toast.error(`Could not load settings: ${e}`);
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      closeToTray = await invoke<boolean>("get_close_to_tray");
    } catch {
      // Pre-tray builds or non-Tauri preview — leave the default and let
      // the UI render the optimistic value.
    }
  }

  async function toggleCloseToTray() {
    const next = !closeToTray;
    closeToTray = next;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_close_to_tray", { enabled: next });
    } catch (e) {
      // Roll back on failure so the UI mirrors the actual persisted state.
      closeToTray = !next;
      toast.error(`Could not update setting: ${e}`);
    }
  }

  function updateTheme(theme: Theme) {
    setMode(theme);
    currentTheme = theme;
  }

  function updateEditorWindow(value: EditorBehavior) {
    editorWindow = value;
    safeStorage.set("recast-editor-window", value);
  }

  function updateCountdown(value: CountdownSeconds) {
    countdown = value;
    recordingCountdown.set(value);
  }

  const countdownOptions: { value: CountdownSeconds; label: string }[] = [
    { value: 0, label: "Off" },
    { value: 3, label: "3s" },
    { value: 5, label: "5s" },
    { value: 10, label: "10s" },
  ];

  async function pickDirectory() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Recording Directory",
    });
    if (selected && typeof selected === "string") {
      try {
        await setOutputDir(selected);
        outputDir = selected;
        toast.success("Output directory updated");
      } catch (e) {
        toast.error(`Could not set directory: ${e}`);
      }
    }
  }

  const layoutModeIcons: Record<LayoutMode, typeof Monitor> = {
    "os-native": Monitor,
    recast: PanelsTopLeft,
  };

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const editorBehaviors: {
    value: EditorBehavior;
    label: string;
    icon: typeof Navigation;
  }[] = [
    { value: "navigate", label: "Navigate", icon: Navigation },
    { value: "new-window", label: "New window", icon: ExternalLink },
  ];
</script>

<div class="h-full overflow-y-auto scrollbar-transparent no-scrollbar">
  <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
    <!-- Hero -->
    <header
      in:fly={{ y: 12, duration: 320, easing: cubicOut }}
      class="flex flex-col gap-3"
    >
      <span
        class="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/80 backdrop-blur"
      >
        <SettingsIcon class="size-3 text-primary" />
        Settings
      </span>
      <h1
        class="text-balance text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[32px]"
      >
        <span
          class="bg-linear-to-r from-foreground to-foreground/55 bg-clip-text text-transparent"
        >
          Make Recast feel like yours.
        </span>
      </h1>
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        Tune storage, theme and editor defaults. Changes save instantly.
      </p>
    </header>

    <!-- Tabs, grouped by concern:
           General      — appearance, window behavior + telemetry consent
           Recording    — storage, editor, capture profiles (daily-use)
           Cloud        — Recast Cloud + Google Drive (network integrations)
           Experimental — opt-in unfinished features
           About        — version, links, and device/encoder diagnostics
         Telemetry lives under General (it's a small, two-toggle consent
         block, not its own surface); Experimental gets a dedicated tab so
         its growing flag list doesn't crowd anything else.
         Each panel slides/fades in via tw-animate-css inside Tabs.Content. -->
    <div
      in:fly={{ y: 12, duration: 320, delay: 80, easing: cubicOut }}
      class="flex min-w-0 flex-col gap-6"
    >
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => (activeTab = v as SettingsTab)}
        class="flex flex-col gap-6"
      >
        <Tabs.List
          variant="soft"
          class="grid w-full max-w-2xl grid-cols-5 gap-1 p-1"
        >
          <Tabs.Trigger value="general" class="gap-1.5 px-2">
            <SettingsIcon class="size-3.5" />
            <span class="text-[12px] font-semibold">General</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="recording" class="gap-1.5 px-2">
            <Video class="size-3.5" />
            <span class="text-[12px] font-semibold">Recording</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="cloud" class="gap-1.5 px-2">
            <Cloud class="size-3.5" />
            <span class="text-[12px] font-semibold">Cloud</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="experimental" class="gap-1.5 px-2">
            <FlaskConical class="size-3.5" />
            <span class="text-[12px] font-semibold">Experimental</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="about" class="gap-1.5 px-2">
            <Info class="size-3.5" />
            <span class="text-[12px] font-semibold">About</span>
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Each Tabs.Content carries its own subtle slide-in/fade-in via
             tw-animate-css (defined in @recast/ui's tabs-content.svelte) —
             no need for custom Svelte transitions. Panels not matching the
             active value unmount, so we don't pay layout cost. -->
        <Tabs.Content value="recording" class="flex min-w-0 flex-col gap-8">
              <!-- Storage / Output directory -->
              <section id="settings-storage" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    Storage
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Where Recast keeps your recordings.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex flex-col gap-1 px-4 py-3">
                    <span class="text-[12px] font-semibold text-foreground">
                      Output directory
                    </span>
                    <span class="text-[11px] text-muted-foreground">
                      New recordings save here. Existing files stay where they are.
                    </span>
                    <div class="mt-2 flex items-center gap-2">
                      <div
                        class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 font-mono text-[11px] text-muted-foreground"
                        title={outputDir || "Default temporary directory"}
                      >
                        <FolderOpen class="size-3.5 shrink-0 text-muted-foreground/70" />
                        <span class="truncate">
                          {outputDir || "Default temporary directory"}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        class="h-9 shrink-0 gap-1.5"
                        onclick={pickDirectory}
                      >
                        <FolderOpen class="size-3.5" />
                        Change
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Countdown before recording. Read by the recording panel
                   (panel/+page.svelte) via the shared COUNTDOWN_KEY localStorage
                   entry. Recording profiles can override it per-profile for
                   quick access. -->
              <section id="settings-countdown" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <Timer class="size-3 text-primary" />
                    Countdown
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Wait a beat before capture starts — time to switch windows.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Countdown before recording
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        {countdown === 0
                          ? "Recording starts immediately."
                          : `A ${countdown}-second countdown shows in the panel first.`}
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-1 rounded-xl bg-muted/30 p-1 ring-1 ring-inset ring-border/40"
                      role="radiogroup"
                      aria-label="Countdown before recording"
                    >
                      {#each countdownOptions as o (o.value)}
                        {@const active = countdown === o.value}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onclick={() => updateCountdown(o.value)}
                          class={cn(
                            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold tabular-nums transition-all duration-200",
                            active
                              ? "bg-card text-foreground shadow-(--shadow-craft-inset) ring-1 ring-inset ring-border/40"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {o.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </section>

              <!-- Editor -->
              <section id="settings-editor" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    Editor
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Behavior when you open a recording.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Window behavior
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        Replace the current view or pop the editor into its own
                        window.
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-1 rounded-xl bg-muted/30 p-1 ring-1 ring-inset ring-border/40"
                      role="radiogroup"
                      aria-label="Window behavior"
                    >
                      {#each editorBehaviors as b (b.value)}
                        {@const Icon = b.icon}
                        {@const active = editorWindow === b.value}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onclick={() => updateEditorWindow(b.value)}
                          class={cn(
                            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all duration-200",
                            active
                              ? "bg-card text-foreground shadow-(--shadow-craft-inset) ring-1 ring-inset ring-border/40"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon class="size-3.5" />
                          <span>{b.label}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </section>

              <!-- Recording profiles -->
              <section id="settings-profiles" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    Recording profiles
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Save preset combinations of audio, mic, and camera.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Use profile system
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        {profilesStore.enabled
                          ? "Recording panel auto-applies the default profile and shows a switcher."
                          : "Recording panel resets to manual toggles every launch."}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Use profile system"
                      aria-checked={profilesStore.enabled}
                      onclick={toggleProfilesEnabled}
                      class={cn(
                        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                        profilesStore.enabled
                          ? "bg-primary"
                          : "bg-input ring-1 ring-inset ring-border/50",
                      )}
                    >
                      <span
                        class={cn(
                          "size-4 rounded-full bg-card shadow-sm transition-transform",
                          profilesStore.enabled ? "translate-x-4.5" : "translate-x-0.5",
                        )}
                      ></span>
                    </button>
                  </div>
                  {#if profilesStore.enabled}
                    <div
                      class="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-3"
                    >
                      <div class="min-w-0">
                        <div class="text-[12px] font-semibold text-foreground">
                          Manage profiles
                        </div>
                        <div class="text-[11px] text-muted-foreground">
                          {profilesStore.profiles.length === 0
                            ? "No profiles yet."
                            : profilesStore.profiles.length === 1
                              ? "1 profile saved."
                              : `${profilesStore.profiles.length} profiles saved.`}
                        </div>
                      </div>
                      <Button
                        href="/profiles"
                        variant="secondary"
                        size="sm"
                        class="h-8 gap-1.5"
                      >
                        <SlidersIcon class="size-3.5" />
                        <span class="text-[11.5px]">Open profiles</span>
                      </Button>
                    </div>
                  {/if}
                </div>
              </section>
        </Tabs.Content>

        <Tabs.Content value="cloud" class="flex min-w-0 flex-col gap-8">
              <!-- Recast Cloud sign-in. The desktop app is fully usable without
                   it; Cloud unlocks the Loom-style sharing layer (instant
                   share links, viewer analytics, password protection,
                   custom branding). Free tier ships 10 active links with a
                   watermark; paid tier removes both. See [[positioning_plan]]. -->
              <section id="settings-cloud" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <Cloud class="size-3 text-primary" />
                    Recast Cloud
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Share recordings as Loom-style links with viewer analytics,
                    password protection, and custom branding — layered on top of
                    your local recordings.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <CloudSignIn />
                </div>
              </section>

              <!-- Self-hosting server endpoint. Gated behind the `selfHosting`
                   experimental flag (Settings → Experimental) because Recast
                   Cloud's server isn't shipped yet — there's nothing to point
                   at by default, so this stays hidden for everyone except
                   early self-hosters who opt in. When enabled, the Rust
                   resolver validates the URL and falls back to the bundled
                   default, so a bad value can't break sign-in. -->
              {#if experimentalStore.isEnabled("selfHosting")}
                <section id="settings-cloud-endpoint" class="flex flex-col gap-3">
                  <div class="px-1">
                    <h2
                      class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                    >
                      <Server class="size-3 text-primary" />
                      Self-hosting
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-500"
                      >
                        <FlaskConical class="size-2.5" />
                        Experimental
                      </span>
                    </h2>
                    <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                      Run your own Recast Cloud server? Set its address here.
                      Everyone else can leave this on the default.
                    </p>
                  </div>
                  <div
                    class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                  >
                    <CloudEndpoint />
                  </div>
                </section>
              {/if}

              <!-- Google Drive connection. Independent of the cloud Account
                   section above: signing into Recast Cloud and connecting
                   Google Drive are separate authentications. Both belong on
                   the Cloud tab since they're both external integrations
                   that take exports off this machine. -->
              <section id="settings-google-drive" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <HardDrive class="size-3 text-primary" />
                    Google Drive
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Upload exports to your own Drive — files land in a private
                    /Recast/ folder.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <GoogleDriveConnection />
                </div>
              </section>
        </Tabs.Content>

        <Tabs.Content value="general" class="flex min-w-0 flex-col gap-8">
              <!-- Appearance -->
              <section id="settings-appearance" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    Appearance
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Match your system or pick a fixed mode.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Theme
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        {currentTheme === "system"
                          ? "Following your OS preference."
                          : `Locked to ${currentTheme} mode.`}
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-1 rounded-xl bg-muted/30 p-1 ring-1 ring-inset ring-border/40"
                      role="radiogroup"
                      aria-label="Theme"
                    >
                      {#each themes as t (t.value)}
                        {@const Icon = t.icon}
                        {@const active = currentTheme === t.value}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onclick={() => updateTheme(t.value)}
                          class={cn(
                            "flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all duration-200",
                            active
                              ? "bg-card text-foreground shadow-(--shadow-craft-inset) ring-1 ring-inset ring-border/40"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon class="size-3.5" />
                          <span>{t.label}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </section>

              <!-- Layout -->
              <section id="settings-layout" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    Layout
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    How the window titlebar and controls are arranged.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Window chrome
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        {LAYOUT_MODES.find((m) => m.value === layoutMode.current)
                          ?.hint}
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-1 rounded-xl bg-muted/30 p-1 ring-1 ring-inset ring-border/40"
                      role="radiogroup"
                      aria-label="Window chrome layout"
                    >
                      {#each LAYOUT_MODES as m (m.value)}
                        {@const Icon = layoutModeIcons[m.value]}
                        {@const active = layoutMode.current === m.value}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onclick={() => (layoutMode.current = m.value)}
                          class={cn(
                            "flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all duration-200",
                            active
                              ? "bg-card text-foreground shadow-(--shadow-craft-inset) ring-1 ring-inset ring-border/40"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon class="size-3.5" />
                          <span>{m.label}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </section>

              <!-- System -->
              <section id="settings-system" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    System
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Behavior when you close the main window.
                  </p>
                </div>
                <div
                  class="rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Minimize to tray on close
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        {closeToTray
                          ? "Closing the window hides Recast to the system tray. Quit from the tray menu to fully exit."
                          : "Closing the window quits Recast immediately."}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Minimize to tray on close"
                      aria-checked={closeToTray}
                      onclick={toggleCloseToTray}
                      class={cn(
                        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                        closeToTray
                          ? "bg-primary"
                          : "bg-input ring-1 ring-inset ring-border/50",
                      )}
                    >
                      <span
                        class={cn(
                          "size-4 rounded-full bg-card shadow-sm transition-transform",
                          closeToTray ? "translate-x-4.5" : "translate-x-0.5",
                        )}
                      ></span>
                    </button>
                  </div>
                </div>
              </section>

              <!-- Privacy & Telemetry. Two independent, locally-stored opt-ins:
                   usage analytics (strictly opt-in, default off) and crash
                   reports (default on). Both anonymous; crash reports are
                   PII-scrubbed before leaving the machine. -->
              <section id="settings-privacy" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <Shield class="size-3 text-primary" />
                    Privacy & Telemetry
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Recast is offline-first — your recordings never leave this
                    machine. These control anonymous diagnostics only.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Share anonymous usage analytics
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        Which features you use, so we know what to improve. Off by
                        default — nothing is sent unless you turn this on.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Share anonymous usage analytics"
                      aria-checked={desktopConsent.product}
                      onclick={toggleProductAnalytics}
                      class={cn(
                        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                        desktopConsent.product
                          ? "bg-primary"
                          : "bg-input ring-1 ring-inset ring-border/50",
                      )}
                    >
                      <span
                        class={cn(
                          "size-4 rounded-full bg-card shadow-sm transition-transform",
                          desktopConsent.product
                            ? "translate-x-4.5"
                            : "translate-x-0.5",
                        )}
                      ></span>
                    </button>
                  </div>
                  <div
                    class="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-3"
                  >
                    <div class="min-w-0">
                      <div class="text-[12px] font-semibold text-foreground">
                        Send anonymous crash reports
                      </div>
                      <div class="text-[11px] text-muted-foreground">
                        Scrubbed error details when something breaks — no file
                        names or paths. On by default.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Send anonymous crash reports"
                      aria-checked={desktopConsent.errors}
                      onclick={toggleCrashReports}
                      class={cn(
                        "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                        desktopConsent.errors
                          ? "bg-primary"
                          : "bg-input ring-1 ring-inset ring-border/50",
                      )}
                    >
                      <span
                        class={cn(
                          "size-4 rounded-full bg-card shadow-sm transition-transform",
                          desktopConsent.errors
                            ? "translate-x-4.5"
                            : "translate-x-0.5",
                        )}
                      ></span>
                    </button>
                  </div>
                </div>
              </section>

              <DiagnosticsPanel />
        </Tabs.Content>

        <Tabs.Content value="experimental" class="flex min-w-0 flex-col gap-8">
              <!-- Experimental features -->
              <section id="settings-experimental" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <FlaskConical class="size-3 text-primary" />
                    Experimental
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Unfinished features hidden by default — opt in if you want to try
                    them. They may move, break, or disappear.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  {#each FLAG_META as flag, i (flag.key)}
                    {@const on = experimentalStore.isEnabled(flag.key)}
                    <div
                      class={cn(
                        "flex items-center justify-between gap-3 px-4 py-3",
                        i > 0 && "border-t border-border/40",
                      )}
                    >
                      <div class="min-w-0">
                        <div class="text-[12px] font-semibold text-foreground">
                          {flag.label}
                        </div>
                        <div class="text-[11px] text-muted-foreground">
                          {flag.description}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label={flag.label}
                        aria-checked={on}
                        onclick={() => toggleExperimental(flag.key, flag.label)}
                        class={cn(
                          "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                          on
                            ? "bg-primary"
                            : "bg-input ring-1 ring-inset ring-border/50",
                        )}
                      >
                        <span
                          class={cn(
                            "size-4 rounded-full bg-card shadow-sm transition-transform",
                            on ? "translate-x-4.5" : "translate-x-0.5",
                          )}
                        ></span>
                      </button>
                    </div>
                  {/each}
                </div>
              </section>
        </Tabs.Content>

        <Tabs.Content value="about" class="flex min-w-0 flex-col gap-8">
              <!-- About -->
              <section id="settings-about" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    About
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Version info and where to find us.
                  </p>
                </div>
                <div
                  class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/70 p-4 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/5 text-foreground ring-1 ring-inset ring-border/40"
                    >
                      <Logo class="size-6" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-[13px] font-semibold text-foreground">
                        {config.appName}
                      </div>
                      <div class="font-mono text-[10.5px] text-muted-foreground">
                        v{config.appVersion}
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      href="/whats-new"
                      variant="outline"
                      size="sm"
                      class="h-8 gap-1.5"
                    >
                      <Sparkles class="size-3.5 text-primary" />
                      <span class="text-[11.5px]">What's new</span>
                      <ArrowUpRight class="size-3 text-muted-foreground" />
                    </Button>
                    <Button
                      href={config.website}
                      target="_blank"
                      variant="outline"
                      size="sm"
                      class="h-8 gap-1.5"
                    >
                      <Globe class="size-3.5" />
                      <span class="text-[11.5px]">Website</span>
                      <ArrowUpRight class="size-3 text-muted-foreground" />
                    </Button>
                    <Button
                      href={config.github}
                      target="_blank"
                      variant="outline"
                      size="sm"
                      class="h-8 gap-1.5"
                    >
                      <Github class="size-3.5" />
                      <span class="text-[11.5px]">GitHub</span>
                      <ArrowUpRight class="size-3 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </section>

              <!-- Device & diagnostics. Encoder availability is probed live
                   against this machine's GPU (not just "compiled in"), so the
                   matrix reflects what Recast can actually use here — handy in
                   bug reports and for users wondering why capture is on CPU. -->
              <section id="settings-device" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <Cpu class="size-3 text-primary" />
                    Device & diagnostics
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Your platform and which video encoders this device supports.
                  </p>
                </div>
                <DeviceCapabilities />
              </section>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  </div>
</div>
