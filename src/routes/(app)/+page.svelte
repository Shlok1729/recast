<script lang="ts">
    import { goto } from "$app/navigation";
    import { ExternalLink, Pencil, Play, RefreshCw, Video } from "@lucide/svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";

    type RecordingEntry = {
        filename: string;
        path: string;
        size_bytes: number;
        created: number;
    };

    let recordings: RecordingEntry[] = $state([]);
    let isFetching = $state(true);
    let outputDir = $state("");

    onMount(() => {
        fetchSettings();
        fetchRecordings();
    });

    async function fetchSettings() {
        try {
            outputDir = await invoke<string>("get_output_dir");
        } catch (e) {
            console.error(e);
        }
    }

    async function fetchRecordings() {
        isFetching = true;
        try {
            recordings = await invoke<RecordingEntry[]>("list_recordings");
        } catch (e) {
            console.error(e);
        } finally {
            isFetching = false;
        }
    }

    async function openLocation(path: string) {
        await invoke("open_file_location", { path });
    }

    function navigateToEditor(path: string) {
        const encoded = btoa(encodeURIComponent(path));
        goto(`/editor/${encoded}`);
    }

    function formatSize(bytes: number) {
        if (bytes === 0) return "0 B";
        const k = 1024,
            sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    function formatDate(unixSecs: number) {
        return new Date(unixSecs * 1000).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }
</script>

<div class="mx-auto flex w-full flex-1 flex-col p-10">
    <div class="mb-8 flex items-end justify-between">
        <div>
            <h2 class="text-3xl font-semibold tracking-tight text-foreground">
                Recordings
            </h2>
            <p class="mt-1.5 text-sm text-muted-foreground">
                Saved to <span
                    class="font-mono text-xs text-foreground bg-muted px-1.5 py-0.5 rounded-md"
                    >{outputDir || "temporary directory"}</span
                >
            </p>
        </div>

        <button
            onclick={fetchRecordings}
            disabled={isFetching}
            class="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-all disabled:opacity-50 shadow-sm active:scale-95"
            title="Refresh"
        >
            <RefreshCw
                size={16}
                class={isFetching
                    ? "animate-spin"
                    : "group-hover:scale-110 transition-transform"}
            />
        </button>
    </div>

    {#if isFetching}
        <div
            class="flex flex-col items-center justify-center gap-4 py-32 opacity-0 animate-in fade-in duration-500"
        >
            <div
                class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            ></div>
            <span class="text-sm font-medium text-muted-foreground"
                >Loading recordings...</span
            >
        </div>
    {:else if recordings.length === 0}
        <div
            class="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 py-32 hover:bg-card transition-colors duration-500 animate-in fade-in zoom-in-95"
        >
            <div
                class="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
            >
                <Video size={28} strokeWidth={1.5} />
            </div>
            <div class="text-center">
                <h3 class="text-base font-semibold text-foreground">
                    No recordings yet
                </h3>
                <p class="mt-1.5 text-sm text-muted-foreground">
                    Take your first recording from the Trace Panel.
                </p>
            </div>
        </div>
    {:else}
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {#each recordings as item, i}
                <div
                    class="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm hover:border-primary/50 hover:shadow-md transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in"
                    style="animation-delay: {i * 50}ms;"
                >
                    <div
                        class="relative flex aspect-video w-full items-center justify-center bg-muted/50 overflow-hidden border-b border-border"
                    >
                        <Play
                            size={40}
                            class="text-muted-foreground/30 transition-transform duration-500 group-hover:scale-110 group-hover:text-primary/10"
                            fill="currentColor"
                        />

                        <div
                            class="absolute inset-0 bg-background/60 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 flex items-center justify-center gap-2"
                        >
                            <button
                                onclick={() => navigateToEditor(item.path)}
                                class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
                            >
                                <Pencil size={16} />
                                Edit
                            </button>
                            <button
                                onclick={() => openLocation(item.path)}
                                class="flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm ring-1 ring-border hover:bg-accent transition-all hover:scale-105 active:scale-95"
                            >
                                <ExternalLink size={14} />
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-col gap-1 p-4">
                        <h3
                            class="truncate text-sm font-medium text-foreground"
                            title={item.filename}
                        >
                            {item.filename}
                        </h3>
                        <div
                            class="flex items-center gap-2 text-xs text-muted-foreground font-mono"
                        >
                            <span>{formatDate(item.created)}</span>
                            <span class="h-1 w-1 rounded-full bg-border"></span>
                            <span>{formatSize(item.size_bytes)}</span>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
