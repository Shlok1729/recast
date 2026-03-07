<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";

    let outputDir = $state("");
    let isEditingDir = $state(false);
    let newDirInput = $state("");

    onMount(() => {
        fetchSettings();
    });

    async function fetchSettings() {
        try {
            outputDir = await invoke<string>("get_output_dir");
        } catch (e) {
            console.error(e);
        }
    }

    async function saveSettings() {
        try {
            await invoke("set_output_dir", { path: newDirInput });
            outputDir = newDirInput;
            isEditingDir = false;
        } catch (e) {
            alert(`Could not set directory: ${e}`);
        }
    }
</script>

<div class="flex-1 flex flex-col p-8 w-full max-w-3xl mx-auto">
    <div class="mb-10 border-b border-black/5 dark:border-white/5 pb-6">
        <h2
            class="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white"
        >
            Settings
        </h2>
        <p class="text-sm text-neutral-500 mt-1">
            Configure Trace defaults and preferences.
        </p>
    </div>

    <!-- General Settings -->
    <div class="flex flex-col gap-6">
        <section>
            <h3
                class="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-4"
            >
                Storage
            </h3>

            <div
                class="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#1C1C1E] shadow-sm"
            >
                <div class="flex flex-col gap-2">
                    <label
                        class="text-sm font-medium text-neutral-900 dark:text-neutral-100"
                        >Output Directory</label
                    >
                    <p class="text-[13px] text-neutral-500 mb-2">
                        Choose the folder where your Trace recordings are saved.
                    </p>

                    {#if isEditingDir}
                        <input
                            type="text"
                            bind:value={newDirInput}
                            placeholder="C:\Users\Name\Videos"
                            class="w-full px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-[13.5px] text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50 shadow-sm"
                        />
                        <div class="flex items-center gap-2 mt-3">
                            <button
                                onclick={() => (isEditingDir = false)}
                                class="px-4 py-2 text-xs font-medium rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800 transition-colors border border-transparent"
                                >Cancel</button
                            >
                            <button
                                onclick={saveSettings}
                                class="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-violet-600 hover:bg-violet-700 transition-colors shadow-sm active:scale-[0.98]"
                                >Save Directory</button
                            >
                        </div>
                    {:else}
                        <div class="flex items-center gap-3">
                            <div
                                class="flex-1 px-3 py-2.5 rounded-lg bg-neutral-50 dark:bg-black/50 border border-neutral-200 dark:border-neutral-800 text-[13.5px] font-mono tracking-tight text-neutral-600 dark:text-neutral-400 truncate"
                                title={outputDir}
                            >
                                {outputDir || "Default Temporary Directory"}
                            </div>
                            <button
                                onclick={() => {
                                    newDirInput = outputDir;
                                    isEditingDir = true;
                                }}
                                class="px-4 py-2.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-900 dark:text-neutral-100 transition-colors shadow-sm active:scale-[0.98]"
                            >
                                Change
                            </button>
                        </div>
                    {/if}
                </div>
            </div>
        </section>

        <section class="mt-4">
            <h3
                class="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-4"
            >
                About
            </h3>

            <div
                class="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#1C1C1E] shadow-sm flex items-center justify-between"
            >
                <div>
                    <h4
                        class="text-sm font-medium text-neutral-900 dark:text-neutral-100"
                    >
                        Trace MVP
                    </h4>
                    <p class="text-[13px] text-neutral-500 mt-0.5">
                        Version 0.0.1
                    </p>
                </div>
                <div
                    class="w-10 h-10 rounded-lg bg-linear-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-lg shadow-sm"
                >
                    T
                </div>
            </div>
        </section>
    </div>
</div>
