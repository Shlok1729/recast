<script lang="ts">
  import { Button } from "$components/ui/button";
  import DashboardSkeleton from "$components/skeletons/DashboardSkeleton.svelte";
  import FileList from "$components/FileList.svelte";
  import { listRecasts, type RecordingEntry } from "$lib/ipc";
  import { Film, RefreshCw } from "@lucide/svelte";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";

  let entries = $state<RecordingEntry[]>([]);
  let isLoading = $state(true);

  onMount(() => {
    fetchRecasts();
    const unlisten = listen("refresh-recordings", () => fetchRecasts());
    return () => { unlisten.then((fn) => fn()); };
  });

  async function fetchRecasts() {
    isLoading = true;
    try {
      entries = await listRecasts();
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
      <h2 class="text-2xl font-bold tracking-tight text-foreground">Recasts</h2>
      <p class="text-sm text-muted-foreground mt-1">Your screen recordings as .recast projects</p>
    </div>
    <Button variant="outline" size="sm" onclick={fetchRecasts} disabled={isLoading} class="gap-1.5">
      <RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
      Refresh
    </Button>
  </div>

  <FileList
    {entries}
    {isLoading}
    showEditButton
    emptyTitle="No recordings yet"
    emptyDescription="Take your first recording from the Recast Panel."
  >
    {#snippet emptyIcon()}
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Film size={24} />
      </div>
    {/snippet}
    {#snippet skeleton()}
      <DashboardSkeleton />
    {/snippet}
  </FileList>
</div>
