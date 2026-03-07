<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { emit } from "@tauri-apps/api/event";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { onMount } from "svelte";

    type DisplayInfo = {
        id: number;
        name: string;
        width: number;
        height: number;
        is_primary: boolean;
        thumbnail: string | null;
    };
    type WindowInfo = {
        id: number;
        pid: number;
        app_name: string;
        title: string;
        width: number;
        height: number;
        thumbnail: string | null;
    };
    type TargetSource = {
        type: "monitor" | "window";
        id: number;
        label: string;
        appName?: string;
        thumbnail: string | null;
        resolution?: string;
    };

    let sources: TargetSource[] = $state([]);
    let selectedSource: TargetSource | null = $state(null);
    let selectorTab: "monitor" | "window" = $state("monitor");
    let isFetching = $state(true);

    onMount(() => {
        fetchSources();
    });

    async function fetchSources() {
        isFetching = true;
        try {
            const [displays, windows] = await Promise.all([
                invoke<DisplayInfo[]>("get_displays"),
                invoke<WindowInfo[]>("get_windows"),
            ]);
            const newSources: TargetSource[] = [];
            displays.forEach((d, i) =>
                newSources.push({
                    type: "monitor",
                    id: d.id,
                    label: d.is_primary
                        ? "Primary Display"
                        : `Display ${i + 1}`,
                    thumbnail: d.thumbnail,
                    resolution: `${d.width} × ${d.height}`,
                }),
            );
            windows.forEach((w) => {
                if (w.title?.trim()) {
                    newSources.push({
                        type: "window",
                        id: w.id,
                        label: w.title,
                        appName: w.app_name,
                        thumbnail: w.thumbnail,
                        resolution: `${w.width} × ${w.height}`,
                    });
                }
            });
            sources = newSources;
            if (!selectedSource && sources.length > 0)
                selectedSource = sources[0];
        } catch (e) {
            console.error(e);
        } finally {
            isFetching = false;
        }
    }

    async function confirmSelection() {
        if (selectedSource) {
            await emit("source-selected", selectedSource);
            await getCurrentWindow().close();
        }
    }

    async function closeApp() {
        await getCurrentWindow().close();
    }
    async function minimizeWindow() {
        await getCurrentWindow().minimize();
    }

    let monitorSources = $derived(sources.filter((s) => s.type === "monitor"));
    let windowSources = $derived(sources.filter((s) => s.type === "window"));
    let filteredSources = $derived(
        selectorTab === "monitor" ? monitorSources : windowSources,
    );
</script>

<div
    class="w-full h-screen flex flex-col bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-sans overflow-hidden"
>
    <!-- Title bar -->
    <div
        class="flex items-center justify-between px-5 pt-4 pb-0 shrink-0"
        data-tauri-drag-region
    >
        <div class="flex items-center gap-1.5 shrink-0">
            <button
                onclick={closeApp}
                class="w-3 h-3 rounded-full bg-red-500 opacity-75 hover:opacity-100 transition-opacity"
                title="Close"
            ></button>
            <button
                onclick={minimizeWindow}
                class="w-3 h-3 rounded-full bg-yellow-500 opacity-75 hover:opacity-100 transition-opacity"
                title="Minimize"
            ></button>
        </div>
        <span
            class="text-sm font-semibold pointer-events-none select-none"
            data-tauri-drag-region>Choose Source</span
        >
        <button
            onclick={closeApp}
            class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            title="Close"
            aria-label="Close"
        >
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                ><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
            >
        </button>
    </div>

    <!-- Segmented tabs -->
    <div
        class="flex items-center gap-1 mx-5 mt-4 mb-3 p-1 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 shrink-0 select-none"
    >
        <button
            onclick={() => (selectorTab = "monitor")}
            class="flex-1 py-1.5 text-xs font-medium rounded-[10px] transition-all {selectorTab ===
            'monitor'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
        >
            Screens <span class="ml-1 text-[10px] text-neutral-400"
                >{monitorSources.length > 0 ? monitorSources.length : ""}</span
            >
        </button>
        <button
            onclick={() => (selectorTab = "window")}
            class="flex-1 py-1.5 text-xs font-medium rounded-[10px] transition-all {selectorTab ===
            'window'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}"
        >
            Windows <span class="ml-1 text-[10px] text-neutral-400"
                >{windowSources.length > 0 ? windowSources.length : ""}</span
            >
        </button>
    </div>

    <!-- Grid -->
    <div class="flex-1 overflow-y-auto px-5 pb-4 select-none">
        {#if isFetching}
            <div
                class="w-full h-full flex flex-col items-center justify-center gap-3"
            >
                <div
                    class="w-5 h-5 border-2 border-violet-500 rounded-full border-t-transparent animate-spin"
                ></div>
                <span class="text-xs text-neutral-500">Scanning sources...</span
                >
            </div>
        {:else if filteredSources.length === 0}
            <div
                class="w-full h-44 flex flex-col items-center justify-center gap-3"
            >
                <div
                    class="w-10 h-10 rounded-xl flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-neutral-400"
                >
                    <svg
                        class="w-5 h-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        ><rect width="20" height="14" x="2" y="3" rx="2" /><path
                            d="M8 21h8"
                        /><path d="M12 17v4" /></svg
                    >
                </div>
                <p class="text-xs text-neutral-500">
                    No {selectorTab === "monitor" ? "displays" : "windows"} found
                </p>
            </div>
        {:else}
            <div
                class="grid gap-3 {selectorTab === 'monitor'
                    ? 'grid-cols-2'
                    : 'grid-cols-3'}"
            >
                {#each filteredSources as source, i}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        onclick={() => (selectedSource = source)}
                        class="group rounded-xl overflow-hidden cursor-pointer border bg-white dark:bg-neutral-800 transition-all duration-200 {selectedSource?.id ===
                            source.id && selectedSource?.type === source.type
                            ? 'border-violet-500/50 bg-violet-500/10'
                            : 'border-black/5 dark:border-white/5 hover:border-black/15 dark:hover:border-white/15 hover:-translate-y-px hover:shadow-sm'}"
                        style="animation: fadeInUp 0.3s ease-out both; animation-delay: {i *
                            0.03}s;"
                    >
                        <!-- Thumbnail -->
                        <div
                            class="w-full aspect-video bg-black/5 dark:bg-white/5 relative overflow-hidden"
                        >
                            {#if source.thumbnail}
                                <img
                                    src={source.thumbnail}
                                    alt={source.label}
                                    class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                    draggable="false"
                                />
                            {:else}
                                <div
                                    class="w-full h-full flex items-center justify-center text-neutral-300 dark:text-neutral-700"
                                >
                                    <svg
                                        class="w-6 h-6"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.5"
                                        ><rect
                                            width="20"
                                            height="14"
                                            x="2"
                                            y="3"
                                            rx="2"
                                        /><path d="M8 21h8" /><path
                                            d="M12 17v4"
                                        /></svg
                                    >
                                </div>
                            {/if}
                            {#if selectedSource?.id === source.id && selectedSource?.type === source.type}
                                <div
                                    class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center shadow-lg animate-in zoom-in duration-200"
                                >
                                    <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="white"
                                        stroke-width="3"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><path d="M20 6 9 17l-5-5" /></svg
                                    >
                                </div>
                            {/if}
                        </div>
                        <!-- Label -->
                        <div class="px-3 py-2">
                            <div
                                class="text-[11.5px] font-medium truncate leading-tight text-neutral-800 dark:text-neutral-200"
                            >
                                {source.label}
                            </div>
                            {#if source.resolution}
                                <div
                                    class="text-[10px] mt-0.5 text-neutral-400 font-mono tracking-tight"
                                >
                                    {source.resolution}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <!-- Footer -->
    <div
        class="px-5 py-3 flex items-center justify-between border-t border-black/5 dark:border-white/5 shrink-0 bg-neutral-100 dark:bg-neutral-900 select-none"
    >
        <button
            onclick={fetchSources}
            disabled={isFetching}
            class="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-50"
            aria-label="Refresh"
        >
            <svg
                class="w-3.5 h-3.5 {isFetching ? 'animate-spin' : ''}"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                ><path
                    d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
                /><path d="M21 3v5h-5" /></svg
            >
            Refresh
        </button>
        <div class="flex items-center gap-2">
            <button
                onclick={closeApp}
                class="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >Cancel</button
            >
            <button
                onclick={confirmSelection}
                disabled={!selectedSource}
                class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_1px_4px_rgba(139,92,246,0.3)] transition-all active:scale-[0.98]"
                >Confirm</button
            >
        </div>
    </div>
</div>

<style>
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(4px) scale(0.98);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    ::-webkit-scrollbar {
        width: 5px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
    }
    ::-webkit-scrollbar-thumb {
        background: rgba(150, 150, 150, 0.3);
        border-radius: 100px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: rgba(150, 150, 150, 0.5);
    }
</style>
