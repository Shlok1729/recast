<script lang="ts">
  import { Button } from "$components/ui/button";
  import { Card, CardContent } from "$components/ui/card";
  import { config } from "$constants/app";
  import {
    ArrowRight,
    Download,
    Film,
    Keyboard,
    Monitor,
    Radio,
    Scissors,
    SlidersHorizontal,
  } from "@lucide/svelte";

  const steps = [
    {
      icon: Radio,
      title: "Launch Panel",
      description: "Open the recording panel from the sidebar to start capturing your screen.",
    },
    {
      icon: Monitor,
      title: "Select Source",
      description: "Choose a display or window to record. Pick your mic and camera sources.",
    },
    {
      icon: Scissors,
      title: "Edit",
      description: "Trim, add backgrounds, adjust cursor, and apply effects in the editor.",
    },
    {
      icon: Download,
      title: "Export",
      description: "Export as MP4, WebM, or GIF in your preferred quality.",
    },
  ];

  const shortcuts = [
    { keys: "Space", action: "Play / Pause" },
    { keys: "← →", action: "Frame step" },
    { keys: "Ctrl+Z", action: "Undo" },
    { keys: "Ctrl+Shift+Z", action: "Redo" },
  ];
</script>

<div class="flex-1 flex flex-col p-8 w-full max-w-4xl mx-auto">
  <div class="mb-10">
    <h1 class="text-3xl font-bold tracking-tight text-foreground">
      Welcome to {config.appName}
    </h1>
    <p class="text-muted-foreground mt-2">
      Record, edit, and export screen recordings with ease.
    </p>
  </div>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {#each steps as step, i}
      {@const Icon = step.icon}
      <Card class="group transition-shadow hover:shadow-md">
        <CardContent class="flex items-start gap-4 p-5">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon size={20} />
          </div>
          <div>
            <p class="text-sm font-semibold text-foreground">{step.title}</p>
            <p class="mt-1 text-xs text-muted-foreground leading-relaxed">{step.description}</p>
          </div>
        </CardContent>
      </Card>
    {/each}
  </div>

  <div class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
    <a href="/recasts">
      <Card class="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
        <CardContent class="flex items-center justify-between p-5">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Film size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-foreground">Recasts</p>
              <p class="text-xs text-muted-foreground">View your recordings</p>
            </div>
          </div>
          <ArrowRight size={16} class="text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </a>

    <a href="/exports">
      <Card class="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
        <CardContent class="flex items-center justify-between p-5">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Download size={18} />
            </div>
            <div>
              <p class="text-sm font-semibold text-foreground">Exports</p>
              <p class="text-xs text-muted-foreground">View exported videos</p>
            </div>
          </div>
          <ArrowRight size={16} class="text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </a>
  </div>

  <Card class="mt-8">
    <CardContent class="p-5">
      <div class="flex items-center gap-2 mb-3">
        <Keyboard size={16} class="text-muted-foreground" />
        <p class="text-sm font-semibold text-foreground">Keyboard Shortcuts</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        {#each shortcuts as shortcut}
          <div class="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span class="text-xs text-muted-foreground">{shortcut.action}</span>
            <kbd class="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-foreground">
              {shortcut.keys}
            </kbd>
          </div>
        {/each}
      </div>
    </CardContent>
  </Card>
</div>
