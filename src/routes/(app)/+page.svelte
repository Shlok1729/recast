<script lang="ts">
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

<div class="flex-1 flex flex-col p-8 w-full max-w-5xl mx-auto">
    <div class="flex items-center justify-between mb-8">
        <div>
            <h2 class="text-2xl font-bold tracking-tight">Recordings</h2>
            <p class="text-sm text-neutral-500 mt-1">
                Saved to {outputDir || "temporary directory"}
            </p>
        </div>

        <button
            onclick={fetchRecordings}
            disabled={isFetching}
            class="p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-neutral-500 transition-colors disabled:opacity-50"
            title="Refresh"
        >
            <svg
                class="w-5 h-5 {isFetching ? 'animate-spin' : ''}"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                ><path
                    d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
                /><path d="M21 3v5h-5" /></svg
            >
        </button>
    </div>

    {#if isFetching}
        <div
            class="w-full py-20 flex flex-col items-center justify-center gap-3"
        >
            <div
                class="w-6 h-6 border-2 border-violet-500 rounded-full border-t-transparent animate-spin"
            ></div>
            <span class="text-sm text-neutral-500">Loading videos...</span>
        </div>
    {:else if recordings.length === 0}
        <div
            class="w-full py-24 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-800 bg-black/[0.02] dark:bg-white/[0.02]"
        >
            <div
                class="w-12 h-12 flex items-center justify-center text-neutral-400"
            >
                <svg
                    class="w-8 h-8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    ><path
                        d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
                    /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path
                        d="M10 9H8"
                    /><path d="M16 13H8" /><path d="M16 17H8" /></svg
                >
            </div>
            <div class="text-center">
                <h3 class="font-medium text-neutral-900 dark:text-neutral-100">
                    No recordings
                </h3>
                <p class="text-sm text-neutral-500 mt-1">
                    Take your first recording from the Trace Panel.
                </p>
            </div>
        </div>
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {#each recordings as item}
                <div
                    class="group flex flex-col border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-xl overflow-hidden hover:border-violet-500/50 hover:shadow-lg transition-all duration-200"
                >
                    <div
                        class="w-full aspect-video bg-neutral-100 dark:bg-black/50 flex items-center justify-center relative border-b border-black/5 dark:border-white/5"
                    >
                        <svg
                            class="w-10 h-10 text-neutral-300 dark:text-neutral-700"
                            viewBox="0 0 24 24"
                            fill="currentColor"><path d="M8 5v14l11-7z" /></svg
                        >

                        <button
                            onclick={() => openLocation(item.path)}
                            class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white backdrop-blur-sm transition-all duration-200"
                        >
                            <span
                                class="text-sm font-medium flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-md"
                            >
                                <svg
                                    class="w-4 h-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    ><path
                                        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                                    /><polyline points="15 3 21 3 21 9" /><line
                                        x1="10"
                                        x2="21"
                                        y1="14"
                                        y2="3"
                                    /></svg
                                >
                                Reveal in Explorer
                            </span>
                        </button>
                    </div>

                    <div class="p-4 flex flex-col gap-1.5 text-left">
                        <h3
                            class="font-medium text-[13.5px] truncate text-neutral-900 dark:text-neutral-100"
                            title={item.filename}
                        >
                            {item.filename}
                        </h3>
                        <div
                            class="flex items-center text-xs text-neutral-500 font-mono tracking-tight gap-2"
                        >
                            <span>{formatDate(item.created)}</span>
                            <span
                                class="w-1 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700"
                            ></span>
                            <span>{formatSize(item.size_bytes)}</span>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
