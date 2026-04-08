<script lang="ts">
  import { Button } from "$components/ui/button";
  import DashboardSkeleton from "$components/skeletons/DashboardSkeleton.svelte";
  import FileList from "$components/FileList.svelte";
  import { listExports, type RecordingEntry } from "$lib/ipc";
  import { Download, RefreshCw } from "@lucide/svelte";
  import { onMount } from "svelte";

  let entries = $state<RecordingEntry[]>([]);
  let isLoading = $state(true);

  onMount(() => {
    fetchExports();
  });

  async function fetchExports() {
    isLoading = true;
    try {
      entries = await listExports();
    } catch (e) {
      console.error(e);
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="flex-1 flex flex-col p-8 w-full max-w-6xl mx-auto">
  <div class="mb-6 flex items-center justify-between">
    <div>
      <h2 class="text-2xl font-bold tracking-tight text-foreground">Exports</h2>
      <p class="text-sm text-muted-foreground mt-1">Exported videos ready to share</p>
    </div>
    <Button variant="outline" size="sm" onclick={fetchExports} disabled={isLoading} class="gap-1.5">
      <RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
      Refresh
    </Button>
  </div>

  <FileList
    {entries}
    {isLoading}
    emptyTitle="No exports yet"
    emptyDescription="Export a recording from the editor to see it here."
  >
    {#snippet emptyIcon()}
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Download size={24} />
      </div>
    {/snippet}
    {#snippet skeleton()}
      <DashboardSkeleton />
    {/snippet}
  </FileList>
</div>
