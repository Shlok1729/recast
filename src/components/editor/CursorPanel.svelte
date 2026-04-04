<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import { Eye, EyeOff, MousePointer, Sparkles } from "@lucide/svelte";
	import SliderControl from "./SliderControl.svelte";

	interface Props {
		store: EditorStore;
	}

	let { store }: Props = $props();

	const highlightColors = [
		"#3b82f6",
		"#ef4444",
		"#22c55e",
		"#f59e0b",
		"#8b5cf6",
		"#ec4899",
		"#06b6d4",
		"#ffffff",
	];
</script>

<div class="flex flex-col gap-5 animate-in fade-in duration-300">
	<!-- Cursor Visibility -->
	<section>
		<div class="flex items-center justify-between">
			<h4
				class="flex items-center gap-2 text-sm font-semibold text-foreground"
			>
				<MousePointer size={14} class="text-muted-foreground" />
				Cursor
			</h4>
			<button
				onclick={() => {
					store.cursorSettings = {
						...store.cursorSettings,
						enabled: !store.cursorSettings.enabled,
					};
				}}
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all duration-200
					{store.cursorSettings.enabled
					? 'bg-primary/10 text-primary'
					: 'bg-muted text-muted-foreground'}"
			>
				{#if store.cursorSettings.enabled}
					<Eye size={12} />
					Visible
				{:else}
					<EyeOff size={12} />
					Hidden
				{/if}
			</button>
		</div>
	</section>

	{#if store.cursorSettings.enabled}
		<!-- Cursor Size -->
		<section class="animate-in fade-in slide-in-from-top-2 duration-200">
			<SliderControl
				label="Size"
				value={store.cursorSettings.size}
				min={1}
				max={5}
				step={1}
				onchange={(v) => {
					store.cursorSettings = { ...store.cursorSettings, size: v };
				}}
			>
				{#snippet icon()}
					<MousePointer size={12} />
				{/snippet}
			</SliderControl>
		</section>

		<!-- Smoothing -->
		<section
			class="animate-in fade-in slide-in-from-top-2 duration-200"
			style="animation-delay: 50ms"
		>
			<SliderControl
				label="Smoothing"
				value={store.cursorSettings.smoothing}
				min={0}
				max={100}
				step={5}
				unit="%"
				onchange={(v) => {
					store.cursorSettings = {
						...store.cursorSettings,
						smoothing: v,
					};
				}}
			>
				{#snippet icon()}
					<Sparkles size={12} />
				{/snippet}
			</SliderControl>
		</section>

		<!-- Click Highlight -->
		<section
			class="animate-in fade-in slide-in-from-top-2 duration-200"
			style="animation-delay: 100ms"
		>
			<div class="flex items-center justify-between mb-3">
				<span class="text-xs font-medium text-muted-foreground"
					>Click Highlight</span
				>
				<button
					onclick={() => {
						store.cursorSettings = {
							...store.cursorSettings,
							highlightClicks:
								!store.cursorSettings.highlightClicks,
						};
					}}
					class="relative h-5 w-9 rounded-full transition-colors duration-200
						{store.cursorSettings.highlightClicks ? 'bg-primary' : 'bg-muted'}"
				>
					<div
						class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
							{store.cursorSettings.highlightClicks ? 'translate-x-4' : 'translate-x-0.5'}"
					></div>
				</button>
			</div>

			{#if store.cursorSettings.highlightClicks}
				<div
					class="flex flex-wrap gap-1.5 animate-in fade-in duration-150"
				>
					{#each highlightColors as color}
						<button
							onclick={() => {
								store.cursorSettings = {
									...store.cursorSettings,
									highlightColor: color,
								};
							}}
							class="h-6 w-6 rounded-full border-2 transition-all duration-150
								{store.cursorSettings.highlightColor === color
								? 'border-foreground scale-110 shadow-md'
								: 'border-transparent hover:scale-105'}"
							style="background-color: {color}"
						></button>
					{/each}
				</div>

				<div class="mt-3">
					<SliderControl
						label="Highlight Opacity"
						value={store.cursorSettings.highlightOpacity}
						min={10}
						max={100}
						step={5}
						unit="%"
						onchange={(v) => {
							store.cursorSettings = {
								...store.cursorSettings,
								highlightOpacity: v,
							};
						}}
					/>
				</div>
			{/if}
		</section>

		<!-- Hide When Idle -->
		<section
			class="animate-in fade-in slide-in-from-top-2 duration-200"
			style="animation-delay: 150ms"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground"
					>Hide when idle</span
				>
				<button
					onclick={() => {
						store.cursorSettings = {
							...store.cursorSettings,
							hideWhenIdle: !store.cursorSettings.hideWhenIdle,
						};
					}}
					class="relative h-5 w-9 rounded-full transition-colors duration-200
						{store.cursorSettings.hideWhenIdle ? 'bg-primary' : 'bg-muted'}"
				>
					<div
						class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
							{store.cursorSettings.hideWhenIdle ? 'translate-x-4' : 'translate-x-0.5'}"
					></div>
				</button>
			</div>

			{#if store.cursorSettings.hideWhenIdle}
				<div class="mt-2 animate-in fade-in duration-150">
					<SliderControl
						label="Idle Timeout"
						value={store.cursorSettings.idleTimeout}
						min={1}
						max={10}
						step={1}
						unit="s"
						onchange={(v) => {
							store.cursorSettings = {
								...store.cursorSettings,
								idleTimeout: v,
							};
						}}
					/>
				</div>
			{/if}
		</section>
	{/if}
</div>
