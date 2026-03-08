<script lang="ts">
    import { Button } from "$components/ui/button";
    import { Input } from "$components/ui/input";
    import { Label } from "$components/ui/label";
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
    <div class="mb-10 border-b pb-6">
        <h2 class="text-2xl font-bold tracking-tight text-foreground">
            Settings
        </h2>
        <p class="text-sm text-muted-foreground mt-1">
            Configure Trace defaults and preferences.
        </p>
    </div>

    <div class="flex flex-col gap-6">
        <section>
            <h3
                class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4"
            >
                Storage
            </h3>

            <div class="p-5 rounded-xl border bg-card shadow-sm">
                <div class="flex flex-col gap-2">
                    <Label>Output Directory</Label>
                    <p class="text-[13px] text-muted-foreground mb-2">
                        Choose the folder where your Trace recordings are saved.
                    </p>

                    <div class="flex items-center gap-3">
                        <Input
                            class="flex-1 px-3 py-2.5 rounded-lg truncate"
                            title={outputDir}
                            value={outputDir || "Default Temporary Directory"}
                            readonly
                            disabled
                            id="output-dir"
                        />
                        <Button
                            variant="outline"
                            type="button"
                            onclick={async () => {
                                const { open } = await import(
                                    "@tauri-apps/plugin-dialog"
                                );
                                const selected = await open({
                                    directory: true,
                                    multiple: false,
                                    title: "Select Recording Directory",
                                });
                                if (selected && typeof selected === "string") {
                                    try {
                                        await invoke("set_output_dir", {
                                            path: selected,
                                        });
                                        outputDir = selected;
                                    } catch (e) {
                                        alert(`Could not set directory: ${e}`);
                                    }
                                }
                            }}
                        >
                            Change
                        </Button>
                    </div>
                </div>
            </div>
        </section>

        <section class="mt-4">
            <h3
                class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4"
            >
                About
            </h3>

            <div
                class="p-5 rounded-xl border bg-card shadow-sm flex items-center justify-between"
            >
                <div>
                    <h4 class="text-sm font-medium text-foreground">
                        Trace MVP
                    </h4>
                    <p class="text-sm text-muted-foreground mt-0.5">
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
