<script lang="ts">
    import { getDisplays, startRecording, stopRecording } from "$lib/ipc";
    import { emit, listen } from "@tauri-apps/api/event";
    import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { Monitor, AppWindow as AppWindowIcon, X, ChevronDown } from "@lucide/svelte";
    import { onMount } from "svelte";

    type TargetSource = {
        type: "monitor" | "window";
        id: number;
        label: string;
    };

    let selectedSource: TargetSource | null = $state(null);
    let isRecording = $state(false);
    let recordingStartTime: number | null = $state(null);
    let now = $state(Date.now());

    onMount(() => {
        const timer = window.setInterval(() => {
            if (isRecording) now = Date.now();
        }, 1000);

        const unlisten = listen<TargetSource>("source-selected", (event) => {
            selectedSource = event.payload;
        });

        // Non-blocking display fetch
        getDisplays()
            .then((displays) => {
                if (displays.length > 0 && !selectedSource) {
                    const d = displays[0];
                    selectedSource = {
                        type: "monitor",
                        id: d.id,
                        label: d.isPrimary ? "Primary Display" : `Display ${d.id}`,
                    };
                }
            })
            .catch(() => {});

        return () => {
            window.clearInterval(timer);
            unlisten.then((fn) => fn());
        };
    });

    function openSourceSelector() {
        if (isRecording) return;
        WebviewWindow.getByLabel("source-selector").then(async (existing) => {
            if (existing) {
                await existing.setFocus();
                return;
            }
            const win = new WebviewWindow("source-selector", {
                url: "/select",
                title: "Select Source",
                width: 560,
                height: 440,
                center: true,
                decorations: false,
                resizable: false,
            });
            win.once("tauri://error", (e) => console.error(e));
        });
    }

    function closePanel() {
        getCurrentWindow().close();
    }

    async function toggleRecording() {
        if (isRecording) {
            try {
                await stopRecording();
                isRecording = false;
                recordingStartTime = null;
                emit("refresh-recordings");
            } catch (e) {
                alert(`Stop failed: ${e}\n\nMake sure ffmpeg is installed.`);
            }
        } else {
            if (!selectedSource) return;
            try {
                await startRecording(selectedSource.type, selectedSource.id);
                isRecording = true;
                now = Date.now();
                recordingStartTime = now;
            } catch (e) {
                alert(`Recording failed: ${e}`);
            }
        }
    }

    const elapsed = $derived(
        isRecording && recordingStartTime
            ? Math.floor((now - recordingStartTime) / 1000)
            : 0,
    );
    const timer = $derived(
        `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`,
    );
</script>

<div
    class="h-full w-full flex items-center gap-1.5 px-3 rounded-full bg-neutral-900/95 backdrop-blur-2xl text-white shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden select-none"
    data-tauri-drag-region
>
    <!-- Record button -->
    <button
        onclick={toggleRecording}
        onmousedown={(e) => e.stopPropagation()}
        class="size-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 active:scale-90
            {isRecording
            ? 'bg-red-500 hover:bg-red-400'
            : 'bg-linear-to-br from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400'}"
        title={isRecording ? "Stop Recording" : "Start Recording"}
    >
        {#if isRecording}
            <div class="size-2 rounded-sm bg-white"></div>
        {:else}
            <div class="size-2 rounded-full bg-white"></div>
        {/if}
    </button>

    <!-- Divider -->
    <div class="w-px h-3.5 bg-white/10 shrink-0"></div>

    <!-- Source selector -->
    <button
        disabled={isRecording}
        onclick={openSourceSelector}
        onmousedown={(e) => e.stopPropagation()}
        class="flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md transition-colors hover:bg-white/8 disabled:opacity-40 disabled:pointer-events-none"
    >
        {#if selectedSource?.type === "window"}
            <AppWindowIcon size={12} strokeWidth={2} class="shrink-0 text-white/50" />
        {:else}
            <Monitor size={12} strokeWidth={2} class="shrink-0 text-white/50" />
        {/if}
        <span class="text-[11px] font-medium text-white/80 truncate max-w-28">
            {selectedSource?.label ?? "Select source"}
        </span>
        {#if !isRecording}
            <ChevronDown size={10} class="shrink-0 text-white/30" />
        {/if}
    </button>

    <!-- Timer -->
    <span
        class="font-mono text-[11px] tabular-nums text-white/40 shrink-0 ml-auto"
        data-tauri-drag-region
    >
        {timer}
    </span>

    <!-- Close -->
    <button
        onclick={closePanel}
        onmousedown={(e) => e.stopPropagation()}
        class="size-5 rounded-full flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/8 transition-colors shrink-0"
        title="Close"
    >
        <X size={11} strokeWidth={2.5} />
    </button>
</div>
