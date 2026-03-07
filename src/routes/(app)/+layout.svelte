<script lang="ts">
    import { page } from "$app/stores";
    import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

    let navItems = [
        {
            label: "Dashboard",
            href: "/",
            icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
        },
        {
            label: "Settings",
            href: "/settings",
            icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
        },
    ];

    async function launchRecordingPanel() {
        const existing = await WebviewWindow.getByLabel("recording-panel");
        if (existing) {
            await existing.setFocus();
            return;
        }

        const panelWin = new WebviewWindow("recording-panel", {
            url: "/panel",
            title: "Trace Panel",
            width: 380,
            height: 64,
            center: true,
            decorations: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
        });

        panelWin.once("tauri://error", (e) => console.error(e));
    }
</script>

<div
    class="h-screen flex bg-neutral-100 dark:bg-neutral-950 font-sans text-neutral-900 dark:text-neutral-100"
>
    <!-- Sidebar -->
    <aside
        class="w-64 border-r border-black/5 dark:border-white/5 bg-white dark:bg-[#151515] flex flex-col"
    >
        <div
            class="h-16 flex items-center px-6 gap-3 shrink-0 select-none"
            data-tauri-drag-region
        >
            <div
                class="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-sm"
                data-tauri-drag-region
            >
                T
            </div>
            <h1
                class="font-semibold tracking-tight text-base"
                data-tauri-drag-region
            >
                Trace Studio
            </h1>
        </div>

        <nav class="flex-1 px-4 py-6 flex flex-col gap-1.5">
            {#each navItems as item}
                <a
                    href={item.href}
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors {$page
                        .url.pathname === item.href
                        ? 'bg-black/5 dark:bg-white/10 text-neutral-900 dark:text-white'
                        : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-black-[0.02] dark:hover:bg-white-[0.02]'}"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        class="w-4 h-4 {$page.url.pathname === item.href
                            ? 'opacity-100'
                            : 'opacity-70'}"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d={item.icon} />
                    </svg>
                    {item.label}
                </a>
            {/each}
        </nav>

        <div class="p-4 border-t border-black/5 dark:border-white/5">
            <button
                onclick={launchRecordingPanel}
                class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg font-medium text-sm transition-colors shadow-sm"
            >
                <div
                    class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"
                ></div>
                Recording Panel
            </button>
        </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 flex flex-col h-full min-w-0 overflow-y-auto">
        <slot />
    </main>
</div>
