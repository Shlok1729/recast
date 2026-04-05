<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import {
		Activity,
		Eye,
		EyeOff,
		MousePointer,
		Sparkles,
	} from "@lucide/svelte";
	import InspectorHint from "./InspectorHint.svelte";
	import SliderControl from "./SliderControl.svelte";

	interface Props {
		store: EditorStore;
	}

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

	let { store }: Props = $props();

	function updateCursorSettings(
		updates: Partial<EditorStore["cursorSettings"]>,
		trackUndo = false,
	) {
		if (trackUndo) {
			store.pushUndoState();
		}
		store.updateCursorSettings(updates);
	}
</script>

<div class="flex flex-col gap-4 animate-in fade-in duration-300">
	<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
		<div class="flex items-start justify-between gap-3">
			<div>
				<div class="flex items-center gap-2">
					<h3 class="text-sm font-semibold text-foreground">Cursor</h3>
					<InspectorHint content="These controls tune how the captured pointer feels during playback." />
				</div>
			</div>

			<button
				type="button"
				onclick={() =>
					updateCursorSettings(
						{ enabled: !store.cursorSettings.enabled },
						true,
					)}
				aria-pressed={store.cursorSettings.enabled}
				class="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors {store.cursorSettings.enabled
					? 'border-primary/30 bg-primary/10 text-primary'
					: 'border-border/70 bg-background/80 text-muted-foreground hover:text-foreground'}"
			>
				{#if store.cursorSettings.enabled}
					<Eye size={14} />
					Cursor visible
				{:else}
					<EyeOff size={14} />
					Cursor hidden
				{/if}
			</button>
		</div>

		<div class="mt-4 grid grid-cols-3 gap-2">
			<div class="rounded-2xl border border-border/70 bg-background/70 p-3">
				<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
					Size
				</p>
				<p class="mt-1 text-sm font-semibold text-foreground">
					{store.cursorSettings.size}x
				</p>
			</div>
			<div class="rounded-2xl border border-border/70 bg-background/70 p-3">
				<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
					Highlight
				</p>
				<p class="mt-1 text-sm font-semibold text-foreground">
					{store.cursorSettings.highlightClicks ? "On" : "Off"}
				</p>
			</div>
			<div class="rounded-2xl border border-border/70 bg-background/70 p-3">
				<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
					Idle hide
				</p>
				<p class="mt-1 text-sm font-semibold text-foreground">
					{store.cursorSettings.hideWhenIdle ? "Enabled" : "Disabled"}
				</p>
			</div>
		</div>
	</section>

	{#if store.cursorSettings.enabled}
		<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
			<div class="mb-3 flex items-center gap-2">
				<h4 class="text-sm font-semibold text-foreground">Pointer feel</h4>
				<InspectorHint content="Size changes legibility. Smoothing makes motion feel less jittery." />
			</div>

			<div class="space-y-3">
				<SliderControl
					label="Cursor size"
					value={store.cursorSettings.size}
					min={1}
					max={5}
					step={1}
					unit="x"
					onstart={() => store.pushUndoState()}
					onchange={(nextValue) => {
						store.updateCursorSettings({ size: nextValue });
					}}
				>
					{#snippet icon()}
						<MousePointer size={12} />
					{/snippet}
				</SliderControl>

				<SliderControl
					label="Motion smoothing"
					value={store.cursorSettings.smoothing}
					min={0}
					max={100}
					step={5}
					unit="%"
					onstart={() => store.pushUndoState()}
					onchange={(nextValue) => {
						store.updateCursorSettings({ smoothing: nextValue });
					}}
				>
					{#snippet icon()}
						<Sparkles size={12} />
					{/snippet}
				</SliderControl>
			</div>
		</section>

		<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
			<div class="mb-3 flex items-start justify-between gap-3">
				<div class="flex items-center gap-2">
					<h4 class="text-sm font-semibold text-foreground">Click highlight</h4>
					<InspectorHint content="Useful for tutorials and product demos where click targets should be obvious." />
				</div>

				<button
					type="button"
					onclick={() =>
						updateCursorSettings(
							{
								highlightClicks: !store.cursorSettings.highlightClicks,
							},
							true,
						)}
					aria-pressed={store.cursorSettings.highlightClicks}
					aria-label={
						store.cursorSettings.highlightClicks
							? "Disable click highlight"
							: "Enable click highlight"
					}
					class="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors {store.cursorSettings.highlightClicks
						? 'border-primary/30 bg-primary/10 text-primary'
						: 'border-border/70 bg-background/80 text-muted-foreground hover:text-foreground'}"
				>
					<Activity size={14} />
					{store.cursorSettings.highlightClicks ? "Enabled" : "Disabled"}
				</button>
			</div>

			{#if store.cursorSettings.highlightClicks}
				<div class="grid grid-cols-4 gap-2">
					{#each highlightColors as color}
						<button
							type="button"
							onclick={() =>
								updateCursorSettings(
									{ highlightColor: color },
									store.cursorSettings.highlightColor !== color,
								)}
							aria-label={`Use ${color} click highlight color`}
							aria-pressed={store.cursorSettings.highlightColor === color}
							class="rounded-2xl border p-2 transition-all duration-200 {store.cursorSettings.highlightColor ===
							color
								? 'border-foreground shadow-md ring-2 ring-foreground/10'
								: 'border-border/60 hover:border-border hover:shadow-sm'}"
						>
							<div
								class="h-8 w-full rounded-xl border border-black/5"
								style="background-color: {color}"
							></div>
						</button>
					{/each}
				</div>

				<div class="mt-3">
					<SliderControl
						label="Highlight opacity"
						value={store.cursorSettings.highlightOpacity}
						min={10}
						max={100}
						step={5}
						unit="%"
						onstart={() => store.pushUndoState()}
						onchange={(nextValue) => {
							store.updateCursorSettings({
								highlightOpacity: nextValue,
							});
						}}
					/>
				</div>
			{/if}
		</section>

		<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
			<div class="mb-3 flex items-start justify-between gap-3">
				<div class="flex items-center gap-2">
					<h4 class="text-sm font-semibold text-foreground">Idle behavior</h4>
					<InspectorHint content="Hide the cursor after inactivity for cleaner sections without interaction." />
				</div>

				<button
					type="button"
					onclick={() =>
						updateCursorSettings(
							{
								hideWhenIdle: !store.cursorSettings.hideWhenIdle,
							},
							true,
						)}
					aria-pressed={store.cursorSettings.hideWhenIdle}
					aria-label={
						store.cursorSettings.hideWhenIdle
							? "Disable hide cursor when idle"
							: "Enable hide cursor when idle"
					}
					class="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors {store.cursorSettings.hideWhenIdle
						? 'border-primary/30 bg-primary/10 text-primary'
						: 'border-border/70 bg-background/80 text-muted-foreground hover:text-foreground'}"
				>
					{store.cursorSettings.hideWhenIdle ? "Enabled" : "Disabled"}
				</button>
			</div>

			{#if store.cursorSettings.hideWhenIdle}
				<SliderControl
					label="Idle timeout"
					value={store.cursorSettings.idleTimeout}
					min={1}
					max={10}
					step={1}
					unit="s"
					onstart={() => store.pushUndoState()}
					onchange={(nextValue) => {
						store.updateCursorSettings({ idleTimeout: nextValue });
					}}
				/>
			{/if}
		</section>
	{:else}
		<section class="rounded-3xl border border-dashed border-border/70 bg-card/70 p-5 shadow-sm">
			<div class="flex items-start gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted/80 text-muted-foreground">
					<EyeOff size={18} />
				</div>
				<div>
					<h4 class="text-sm font-semibold text-foreground">Cursor hidden</h4>
					<p class="mt-1 text-xs text-muted-foreground">Enable it anytime</p>
				</div>
			</div>
		</section>
	{/if}
</div>
