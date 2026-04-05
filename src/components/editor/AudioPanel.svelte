<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import { AudioLines, Volume2, VolumeX } from "@lucide/svelte";
	import InspectorHint from "./InspectorHint.svelte";
	import SliderControl from "./SliderControl.svelte";

	interface Props {
		store: EditorStore;
	}

	let { store }: Props = $props();

	function updateAudioSettings(
		updates: Partial<EditorStore["audioSettings"]>,
		trackUndo = false,
	) {
		if (trackUndo) {
			store.pushUndoState();
		}
		store.updateAudioSettings(updates);
	}
</script>

<div class="flex flex-col gap-4 animate-in fade-in duration-300">
	<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<h3 class="text-sm font-semibold text-foreground">Audio</h3>
					<InspectorHint content="Volume affects editor playback and export. Fades are applied during export." />
				</div>
				<div class="mt-3 grid grid-cols-3 gap-2 text-center">
					<div class="rounded-2xl border border-border/70 bg-background/70 px-2 py-2">
						<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Volume</p>
						<p class="mt-1 text-sm font-semibold text-foreground">{store.audioSettings.volume}%</p>
					</div>
					<div class="rounded-2xl border border-border/70 bg-background/70 px-2 py-2">
						<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Fade In</p>
						<p class="mt-1 text-sm font-semibold text-foreground">{store.audioSettings.fadeIn}s</p>
					</div>
					<div class="rounded-2xl border border-border/70 bg-background/70 px-2 py-2">
						<p class="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Fade Out</p>
						<p class="mt-1 text-sm font-semibold text-foreground">{store.audioSettings.fadeOut}s</p>
					</div>
				</div>
			</div>

			<button
				type="button"
				onclick={() =>
					updateAudioSettings({ muted: !store.audioSettings.muted }, true)}
				aria-pressed={store.audioSettings.muted}
				class="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors {store.audioSettings.muted
					? 'border-destructive/30 bg-destructive/10 text-destructive'
					: 'border-primary/30 bg-primary/10 text-primary'}"
			>
				{#if store.audioSettings.muted}
					<VolumeX size={14} />
					Muted
				{:else}
					<Volume2 size={14} />
					Live
				{/if}
			</button>
		</div>
	</section>

	<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
		<div class="mb-3 flex items-center gap-2">
			<h4 class="text-sm font-semibold text-foreground">Mix</h4>
			<InspectorHint content="Mute preserves the chosen volume level so you can toggle it back on quickly." />
		</div>

		<div class="space-y-3">
			<SliderControl
				label="Output volume"
				value={store.audioSettings.volume}
				min={0}
				max={200}
				step={5}
				unit="%"
				disabled={store.audioSettings.muted}
				onstart={() => store.pushUndoState()}
				onchange={(nextValue) => {
					store.updateAudioSettings({ volume: nextValue });
				}}
				formatValue={(value) => `${value}%`}
			>
				{#snippet icon()}
					<AudioLines size={12} />
				{/snippet}
			</SliderControl>
		</div>
	</section>

	<section class="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
		<div class="mb-3 flex items-center gap-2">
			<h4 class="text-sm font-semibold text-foreground">Fades</h4>
			<InspectorHint content="Fades are export-side only, so playback remains responsive while you edit." />
		</div>

		<div class="space-y-3">
			<SliderControl
				label="Fade in"
				value={store.audioSettings.fadeIn}
				min={0}
				max={5}
				step={0.25}
				unit="s"
				onstart={() => store.pushUndoState()}
				onchange={(nextValue) => {
					store.updateAudioSettings({ fadeIn: nextValue });
				}}
				formatValue={(value) => `${value.toFixed(2)}s`}
			/>

			<SliderControl
				label="Fade out"
				value={store.audioSettings.fadeOut}
				min={0}
				max={5}
				step={0.25}
				unit="s"
				onstart={() => store.pushUndoState()}
				onchange={(nextValue) => {
					store.updateAudioSettings({ fadeOut: nextValue });
				}}
				formatValue={(value) => `${value.toFixed(2)}s`}
			/>
		</div>
	</section>
</div>
