<script lang="ts">
  import * as Tabs from "$components/ui/tabs";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { ImageIcon, MousePointer } from "@lucide/svelte";
  import BackgroundPicker from "./BackgroundPicker.svelte";
  import CursorPanel from "./CursorPanel.svelte";

  interface Props {
    store: EditorStore;
  }

  type PanelTab = "background" | "cursor";

  type PanelDefinition = {
    id: PanelTab;
    label: string;
    hint: string;
    icon: typeof ImageIcon;
  };

  const tabs: PanelDefinition[] = [
    {
      id: "background",
      label: "Background",
      hint: "Canvas background, blur, and frame spacing.",
      icon: ImageIcon,
    },
    {
      id: "cursor",
      label: "Cursor",
      hint: "Pointer visibility and emphasis controls for playback.",
      icon: MousePointer,
    },
  ];

  let { store }: Props = $props();

  function formatDuration(seconds: number | undefined) {
    if (!seconds || seconds <= 0) return "--:--";
    const totalSeconds = Math.round(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainderSeconds = totalSeconds % 60;
    return `${minutes}:${remainderSeconds.toString().padStart(2, "0")}`;
  }

  function formatResolution() {
    if (!store.metadata?.width || !store.metadata?.height) return "Unknown";
    return `${store.metadata.width} x ${store.metadata.height}`;
  }

  function formatFrameRate() {
    if (!store.metadata?.fps) return "--";
    return `${Math.round(store.metadata.fps)} fps`;
  }
</script>

<div
  class="flex h-full min-h-0 flex-col bg-linear-to-b from-card via-card/95 to-background/95 backdrop-blur-sm"
>
  <div class="shrink-0 border-b border-border/70 px-4 py-3">
    <div class="flex items-start justify-between gap-3">
      <h3 class="pt-1 text-sm font-semibold text-foreground">Properties</h3>
      <div class="flex flex-wrap items-center justify-end gap-1.5">
        <div
          class="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground"
        >
          {formatDuration(store.metadata?.duration)}
        </div>
        <div
          class="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground"
        >
          {formatResolution()}
        </div>
        <div
          class="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground"
        >
          {formatFrameRate()}
        </div>
      </div>
    </div>
  </div>
  <Tabs.Root value={tabs[0].id} class="p-2 pt-4">
    <Tabs.List class="w-full">
      {#each tabs as tab}
        {@const Icon = tab.icon}
        <Tabs.Trigger value={tab.id}>
          <Icon size={14} />
          {tab.label}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    <Tabs.Content value="background">
      <div
        class="custom-scrollbar min-h-0 h-full flex-1 overflow-y-auto px-4 py-3"
      >
        <BackgroundPicker {store} />
      </div>
    </Tabs.Content>
    <Tabs.Content value="cursor">
      <div
        class="custom-scrollbar min-h-0 h-full flex-1 overflow-y-auto px-4 py-3"
      >
        <CursorPanel {store} />
      </div>
    </Tabs.Content>
  </Tabs.Root>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(120, 120, 128, 0.35);
    border-radius: 999px;
  }

  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(120, 120, 128, 0.35) transparent;
  }
</style>
