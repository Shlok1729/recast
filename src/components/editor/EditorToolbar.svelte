<script lang="ts">
	import { Button } from "$components/ui/button";
	import * as Tooltip from "$components/ui/tooltip";
	import type {
		EditorStore,
		ExportFormat,
	} from "$lib/stores/editor-store.svelte";
	import {
		ArrowLeft,
		ChevronDown,
		Crop,
		Download,
		LayoutGrid,
		Redo2,
		Trash2,
		Undo2,
	} from "@lucide/svelte";

	interface Props {
		store: EditorStore;
		filename?: string;
		onback?: () => void;
		onexport?: () => void;
	}

	let { store, filename = "Recording", onback, onexport }: Props = $props();

	let showFormatMenu = $state(false);
	let showPresetsMenu = $state(false);

	const formats: { value: ExportFormat; label: string; desc: string }[] = [
		{ value: "mp4", label: "MP4", desc: "Best quality, universal" },
		{ value: "webm", label: "WebM", desc: "Web-optimized, smaller" },
		{ value: "gif", label: "GIF", desc: "Animated, shareable" },
	];

	const presets = [
		{ label: "Social Media", bg: "gradient", padding: 40, blur: 30 },
		{ label: "Clean", bg: "color", padding: 0, blur: 0 },
		{ label: "Presentation", bg: "wallpaper", padding: 60, blur: 50 },
		{ label: "Tutorial", bg: "color", padding: 20, blur: 0 },
	];

	function applyPreset(preset: (typeof presets)[0]) {
		store.pushUndoState();
		store.backgroundType = preset.bg as any;
		store.padding = preset.padding;
		store.backgroundBlur = preset.blur;
		showPresetsMenu = false;
	}
</script>

<div
	class="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-3"
>
	<!-- Left: Back + Filename -->
	<div class="flex items-center gap-2 min-w-0">
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={() => onback?.()}
					class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Back to recordings"
				>
					<ArrowLeft size={18} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Back to recordings</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/50 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive active:scale-90"
					aria-label="Delete recording"
				>
					<Trash2 size={15} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Delete recording</Tooltip.Content>
		</Tooltip.Root>

		<div class="mx-1 h-5 w-px bg-border/50"></div>

		<span
			class="truncate text-sm font-medium text-foreground max-w-[200px]"
			title={filename}
		>
			{filename}
		</span>
	</div>

	<!-- Center: Layout + Presets -->
	<div class="flex items-center gap-3">
		<!-- Layout Mode Toggle -->
		<div
			class="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5 border border-border/50"
		>
			<button
				onclick={() => (store.layoutMode = "auto")}
				class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200
					{store.layoutMode === 'auto'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<LayoutGrid size={13} />
				Auto
			</button>
			<button
				onclick={() => (store.layoutMode = "crop")}
				class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200
					{store.layoutMode === 'crop'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Crop size={13} />
				Crop
			</button>
		</div>

		<!-- Presets Dropdown -->
		<div class="relative">
			<button
				onclick={() => {
					showPresetsMenu = !showPresetsMenu;
					showFormatMenu = false;
				}}
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground"
			>
				<span class="text-sm">✦</span>
				Presets
				<ChevronDown
					size={12}
					class="transition-transform duration-200 {showPresetsMenu
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if showPresetsMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="absolute top-full left-0 mt-1 z-50 w-48 rounded-xl border border-border bg-popover p-1 shadow-xl animate-in fade-in zoom-in-95 duration-150"
					onclick={(e) => e.stopPropagation()}
					role="button"
					aria-label="Presets"
				>
					{#each presets as preset}
						<button
							onclick={() => applyPreset(preset)}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
						>
							{preset.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-0.5">
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						onclick={() => store.undo()}
						disabled={!store.canUndo}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
						aria-label="Undo"
					>
						<Undo2 size={16} />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>Undo (Ctrl+Z)</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						onclick={() => store.redo()}
						disabled={!store.canRedo}
						class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
						aria-label="Redo"
					>
						<Redo2 size={16} />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>Redo (Ctrl+Shift+Z)</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</div>

	<!-- Right: Format + Export -->
	<div class="flex items-center gap-2">
		<!-- Format selector -->
		<div class="relative">
			<button
				onclick={() => {
					showFormatMenu = !showFormatMenu;
					showPresetsMenu = false;
				}}
				class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground"
			>
				{store.exportFormat.toUpperCase()}
				<ChevronDown
					size={11}
					class="transition-transform duration-200 {showFormatMenu
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if showFormatMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="absolute top-full right-0 mt-1 z-50 w-52 rounded-xl border border-border bg-popover p-1 shadow-xl animate-in fade-in zoom-in-95 duration-150"
					onclick={(e) => e.stopPropagation()}
				>
					{#each formats as fmt}
						<button
							onclick={() => {
								store.exportFormat = fmt.value;
								showFormatMenu = false;
							}}
							class="flex w-full flex-col items-start rounded-lg px-3 py-2 transition-colors hover:bg-muted
								{store.exportFormat === fmt.value ? 'bg-muted/50' : ''}"
						>
							<span class="text-xs font-semibold text-foreground"
								>{fmt.label}</span
							>
							<span class="text-[10px] text-muted-foreground"
								>{fmt.desc}</span
							>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Export Button -->
		<Button
			onclick={() => onexport?.()}
			disabled={store.isExporting}
			class="relative overflow-hidden bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md hover:from-blue-500 hover:to-blue-400 active:scale-95 transition-all duration-200 h-8 px-4 text-xs font-semibold rounded-lg"
		>
			{#if store.isExporting}
				<div
					class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
				></div>
				Exporting...
			{:else}
				<Download size={14} />
				Export
			{/if}
		</Button>
	</div>
</div>

<!-- Click outside to close menus -->
<svelte:window
	onclick={() => {
		showFormatMenu = false;
		showPresetsMenu = false;
	}}
/>
