<script lang="ts">
  import Logo from "$components/logo.svelte";
  import CloudSignIn from "$components/settings/CloudSignIn.svelte";
  import { config } from "$constants/app";
  import { getOutputDir, setOutputDir } from "$lib/ipc";
  import {
    ArrowUpRight,
    Cloud,
    ExternalLink,
    FlaskConical,
    FolderOpen,
    Github,
    Globe,
    HardDrive,
    Monitor,
    Moon,
    Navigation,
    Settings as SettingsIcon,
    SlidersHorizontal as SlidersIcon,
    Sparkles,
    Sun,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { toast } from "@recast/ui/sonner";
  import * as Tabs from "@recast/ui/tabs";
  import { setMode } from "@recast/ui/theme";
  import { cn } from "@recast/ui/utils";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";

  import {
    FLAG_META,
    experimentalStore,
    type ExperimentalFlag,
  } from "$lib/stores/experimental.svelte";
  import { profilesStore } from "$lib/stores/profiles.svelte";

  type Theme = "light" | "dark" | "system";
  type EditorBehavior = "navigate" | "new-window";
  type SettingsTab = "general" | "local" | "cloud";

  let outputDir = $state("");
  let currentTheme = $state<Theme>("system");
  let editorWindow = $state<EditorBehavior>("navigate");
  // Default to the middle tab so the visual ordering reads naturally
  // (general — local — cloud) while landing the user on the daily-use
  // panel (output dir, profiles, editor behavior).
  let activeTab = $state<SettingsTab>("local");

  onMount(() => {
    fetchSettings();
    profilesStore.hydrate();
    const storedTheme = localStorage.getItem("mode-watcher-mode") as
      | Theme
      | null;
    if (storedTheme) currentTheme = storedTheme;
    const storedEditor = localStorage.getItem(
      "recast-editor-window",
    ) as EditorBehavior | null;
    if (storedEditor) editorWindow = storedEditor;
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

  async function fetchSettings() {
    try {
      outputDir = await getOutputDir();
    } catch (e) {
      toast.error(`Could not load settings: ${e}`);
    }
  }

  function updateTheme(theme: Theme) {
    setMode(theme);
    currentTheme = theme;
  }

  function updateEditorWindow(value: EditorBehavior) {
    editorWindow = value;
    localStorage.setItem("recast-editor-window", value);
  }

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

    <!-- Tabs: Local (offline, daily-use) / Cloud (network-dependent) /
         General (theme, experimental, about). Side-slide transition tracks
         tab order in `TAB_ORDER` so backward navigation slides right and
         forward navigation slides left — same convention as iOS push/pop. -->
    <div
      in:fly={{ y: 12, duration: 320, delay: 80, easing: cubicOut }}
      class="flex min-w-0 flex-col gap-6"
    >
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => (activeTab = v as SettingsTab)}
        class="flex flex-col gap-6"
      >
        <Tabs.List variant="soft" class="grid w-full max-w-md grid-cols-3 gap-1 p-1">
          <Tabs.Trigger value="general" class="gap-1.5 px-3">
            <SettingsIcon class="size-3.5" />
            <span class="text-[12px] font-semibold">General</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="local" class="gap-1.5 px-3">
            <HardDrive class="size-3.5" />
            <span class="text-[12px] font-semibold">Local</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="cloud" class="gap-1.5 px-3">
            <Cloud class="size-3.5" />
            <span class="text-[12px] font-semibold">Cloud</span>
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Each Tabs.Content carries its own subtle slide-in/fade-in via
             tw-animate-css (defined in @recast/ui's tabs-content.svelte) —
             no need for custom Svelte transitions. Panels not matching the
             active value unmount, so we don't pay layout cost. -->
        <Tabs.Content value="local" class="flex min-w-0 flex-col gap-8">
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
                        "flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
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
              <!-- Cloud sign-in. Only section in the Cloud tab today; future
                   additions (devices list, sync status) belong here. -->
              <section id="settings-cloud" class="flex flex-col gap-3">
                <div class="px-1">
                  <h2
                    class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70"
                  >
                    <Cloud class="size-3 text-primary" />
                    Account
                  </h2>
                  <p class="mt-0.5 text-[11px] text-muted-foreground/80">
                    Sign in to sync recordings across devices and share from the
                    cloud.
                  </p>
                </div>
                <div
                  class="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-(--shadow-craft-inset) backdrop-blur"
                >
                  <CloudSignIn />
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
                            "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all duration-200",
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
                          "flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
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
                      <Logo class="size-4" />
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
        </Tabs.Content>
      </Tabs.Root>
    </div>
  </div>
</div>
