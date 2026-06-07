<script lang="ts">
  import { loadRegistryIndex, installFromUrl, removeExtension, toggleExtension } from "$lib/extensions";
  import type { EditorStore } from "$lib/stores/editor-store.svelte";
  import { extensionsStore } from "$lib/stores/extensions-store.svelte";
  import type { InstalledExtension } from "$lib/ipc";
  import {
    Blocks,
    Download,
    Loader2,
    Package,
    RefreshCw,
    Trash2,
  } from "@lucide/svelte";
  import { Button } from "@recast/ui/button";
  import { SegmentedToggle } from "@recast/ui/segmented";
  import { toast } from "@recast/ui/sonner";
  import { cn } from "@recast/ui/utils";
  import { onMount } from "svelte";
  import PanelSection from "./PanelSection.svelte";

  /** One entry of the curated registry index served by the cloud. */
  interface RegistryIndexEntry {
    id: string;
    name: string;
    version?: string;
    author?: string;
    description?: string;
    manifestUrl: string;
    iconUrl?: string;
  }

  interface Props {
    /** Kept for API parity with the other panels (unused today). */
    store: EditorStore;
  }
  let { store: _store }: Props = $props();

  let urlInput = $state("");
  let installingUrl = $state(false);
  let index = $state<RegistryIndexEntry[] | null>(null);
  let loadingIndex = $state(false);

  const installedIds = $derived(
    new Set(extensionsStore.installed.map((e) => e.manifest.id)),
  );

  function contribCount(ext: InstalledExtension): number {
    const c = ext.manifest.contributes ?? {};
    return (
      (c.cursors?.length ?? 0) +
      (c.backgrounds?.length ?? 0) +
      (c.gradients?.length ?? 0) +
      (c.colors?.length ?? 0) +
      (c.easings?.length ?? 0) +
      (c.smoothings?.length ?? 0)
    );
  }

  async function loadGallery() {
    loadingIndex = true;
    try {
      const res = await loadRegistryIndex<{ extensions?: RegistryIndexEntry[] }>();
      index = res?.extensions ?? [];
    } finally {
      loadingIndex = false;
    }
  }

  onMount(loadGallery);

  async function onInstallUrl() {
    const url = urlInput.trim();
    if (!url || installingUrl) return;
    installingUrl = true;
    try {
      const ext = await installFromUrl(url);
      toast.success(`Installed ${ext.manifest.name}`);
      urlInput = "";
    } catch (err) {
      toast.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      installingUrl = false;
    }
  }

  async function onInstallEntry(entry: RegistryIndexEntry) {
    try {
      const ext = await installFromUrl(entry.manifestUrl);
      toast.success(`Installed ${ext.manifest.name}`);
    } catch (err) {
      toast.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onUninstall(ext: InstalledExtension) {
    try {
      await removeExtension(ext.manifest.id);
      toast.success(`Removed ${ext.manifest.name}`);
    } catch (err) {
      toast.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onToggle(ext: InstalledExtension, enabled: boolean) {
    try {
      await toggleExtension(ext.manifest.id, enabled);
    } catch (err) {
      toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
</script>

<div class="flex flex-col gap-4 animate-in fade-in duration-200">
  <div
    class="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5"
  >
    <Blocks class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-[11px] text-muted-foreground">
      Install asset packs to add cursors, backgrounds, gradients and presets.
    </span>
  </div>

  <!-- Install from URL -->
  <PanelSection
    title="Install from URL"
    hint="Paste a pack manifest URL (https, or http://localhost for testing). Assets are SHA-256 verified before install."
    flush
  >
    <div class="flex items-center gap-1.5">
      <input
        type="url"
        bind:value={urlInput}
        placeholder="https://…/extension.json"
        spellcheck="false"
        class="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40"
        onkeydown={(e) => {
          if (e.key === "Enter") onInstallUrl();
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        class="h-7 gap-1 px-2 text-[11px]"
        disabled={!urlInput.trim() || installingUrl}
        onclick={onInstallUrl}
      >
        {#if installingUrl}
          <Loader2 class="size-3 animate-spin" />
        {:else}
          <Download class="size-3" />
        {/if}
        Install
      </Button>
    </div>
    {#if extensionsStore.lastError}
      <p class="mt-1.5 text-[10px] text-destructive">{extensionsStore.lastError}</p>
    {/if}
  </PanelSection>

  <!-- Installed -->
  <PanelSection title="Installed" flush>
    {#snippet action()}
      <span class="font-mono text-[10px] text-muted-foreground/70">
        {extensionsStore.installed.length}
      </span>
    {/snippet}
    {#if extensionsStore.installed.length === 0}
      <p
        class="rounded-md border border-dashed border-border/60 px-2.5 py-3 text-center text-[10.5px] text-muted-foreground"
      >
        No extensions installed yet.
      </p>
    {:else}
      <div class="flex flex-col gap-1">
        {#each extensionsStore.installed as ext (ext.manifest.id)}
          <div
            class="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5"
          >
            <Package class="size-3.5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-[11px] font-medium text-foreground">
                  {ext.manifest.name}
                </span>
                <span class="shrink-0 font-mono text-[9px] text-muted-foreground/70">
                  v{ext.manifest.version}
                </span>
              </div>
              <span class="text-[9.5px] text-muted-foreground/80">
                {contribCount(ext)} item{contribCount(ext) === 1 ? "" : "s"}
                {#if ext.manifest.author}· {ext.manifest.author}{/if}
              </span>
            </div>
            <SegmentedToggle
              checked={ext.enabled}
              offLabel="Off"
              onLabel="On"
              size="xs"
              aria-label={`${ext.manifest.name} enabled`}
              onCheckedChange={(next) => onToggle(ext, next)}
            />
            <Button
              size="icon"
              variant="ghost"
              class="size-6 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${ext.manifest.name}`}
              onclick={() => onUninstall(ext)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  </PanelSection>

  <!-- Browse curated registry -->
  <PanelSection title="Browse" flush>
    {#snippet action()}
      <button
        type="button"
        class="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        onclick={loadGallery}
        disabled={loadingIndex}
      >
        <RefreshCw class={cn("size-2.5", loadingIndex && "animate-spin")} />
        Refresh
      </button>
    {/snippet}
    {#if loadingIndex && !index}
      <p class="px-1 py-2 text-[10.5px] text-muted-foreground">Loading…</p>
    {:else if !index || index.length === 0}
      <p
        class="rounded-md border border-dashed border-border/60 px-2.5 py-3 text-center text-[10.5px] text-muted-foreground"
      >
        No packs available right now.
      </p>
    {:else}
      <div class="flex flex-col gap-1">
        {#each index as entry (entry.id)}
          {@const installed = installedIds.has(entry.id)}
          <div
            class="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5"
          >
            {#if entry.iconUrl}
              <img
                src={entry.iconUrl}
                alt=""
                class="size-7 shrink-0 rounded-md object-cover"
              />
            {:else}
              <div
                class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60"
              >
                <Blocks class="size-3.5 text-muted-foreground" />
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <span class="truncate text-[11px] font-medium text-foreground">
                {entry.name}
              </span>
              {#if entry.description}
                <p class="truncate text-[9.5px] text-muted-foreground/80">
                  {entry.description}
                </p>
              {/if}
            </div>
            <Button
              size="sm"
              variant={installed ? "ghost" : "secondary"}
              class="h-6 gap-1 px-2 text-[10px]"
              disabled={installed || extensionsStore.busy}
              onclick={() => onInstallEntry(entry)}
            >
              {#if installed}
                Installed
              {:else}
                <Download class="size-3" />
                Get
              {/if}
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  </PanelSection>
</div>
