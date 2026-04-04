<script lang="ts">
	import * as Tooltip from "$components/ui/tooltip";
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import {
		Pause,
		Play,
		Scissors,
		SkipBack,
		SkipForward,
		ZoomIn,
		ZoomOut,
	} from "@lucide/svelte";

	interface Props {
		store: EditorStore;
		videoEl?: HTMLVideoElement | null;
	}

	let { store, videoEl = null }: Props = $props();

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 100);
		return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
	}

	const currentTimeFormatted = $derived(formatTime(store.currentTime));
	const durationFormatted = $derived(
		formatTime(store.metadata?.duration ?? 0),
	);

	function togglePlay() {
		if (!videoEl) return;
		if (store.isPlaying) {
			videoEl.pause();
			store.isPlaying = false;
		} else {
			videoEl.play();
			store.isPlaying = true;
		}
	}

	function stepFrame(direction: number) {
		if (!videoEl || !store.metadata) return;
		const frameDuration = 1 / (store.metadata.fps || 30);
		videoEl.currentTime = Math.max(
			0,
			Math.min(
				videoEl.currentTime + frameDuration * direction,
				store.metadata.duration,
			),
		);
		store.currentTime = videoEl.currentTime;
	}

	function handleCut() {
		if (!store.metadata) return;
		// Add a zoom region at current time
		const duration = store.metadata.duration;
		const start = store.currentTime;
		const end = Math.min(start + duration * 0.15, duration);
		store.addZoomRegion(start, end);
	}

	function zoomTimeline(dir: number) {
		store.timelineZoom = Math.max(
			0.5,
			Math.min(5, store.timelineZoom + dir * 0.25),
		);
	}
</script>

<div
	class="flex items-center gap-4 px-6 py-3 border-t border-border bg-card/30 backdrop-blur-sm"
>
	<!-- Timecode -->
	<div class="flex items-center gap-1 shrink-0">
		<span
			class="font-mono text-sm tabular-nums text-foreground font-medium"
		>
			{currentTimeFormatted}
		</span>
		<span class="text-muted-foreground/50 text-sm">/</span>
		<span class="font-mono text-sm tabular-nums text-muted-foreground">
			{durationFormatted}
		</span>
	</div>

	<!-- Spacer -->
	<div class="flex-1"></div>

	<!-- Transport Controls -->
	<div class="flex items-center gap-1">
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={() => stepFrame(-1)}
					class="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Previous frame"
				>
					<SkipBack size={18} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Previous frame</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={togglePlay}
					class="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background transition-all duration-200 hover:opacity-90 active:scale-90 shadow-lg"
					aria-label={store.isPlaying ? "Pause" : "Play"}
				>
					{#if store.isPlaying}
						<Pause size={20} fill="currentColor" />
					{:else}
						<Play size={20} fill="currentColor" class="ml-0.5" />
					{/if}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content
				>{store.isPlaying ? "Pause" : "Play"} (Space)</Tooltip.Content
			>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={() => stepFrame(1)}
					class="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Next frame"
				>
					<SkipForward size={18} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Next frame</Tooltip.Content>
		</Tooltip.Root>
	</div>

	<!-- Spacer -->
	<div class="flex-1"></div>

	<!-- Tools -->
	<div class="flex items-center gap-1 shrink-0">
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={handleCut}
					class="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Add zoom region"
				>
					<Scissors size={16} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Add zoom region</Tooltip.Content>
		</Tooltip.Root>

		<div class="mx-1 h-5 w-px bg-border"></div>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={() => zoomTimeline(1)}
					class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Zoom in timeline"
				>
					<ZoomIn size={15} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Zoom in</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					onclick={() => zoomTimeline(-1)}
					class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-90"
					aria-label="Zoom out timeline"
				>
					<ZoomOut size={15} />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Zoom out</Tooltip.Content>
		</Tooltip.Root>

		<!-- Zoom level indicator -->
		<span
			class="ml-1 text-[11px] font-mono tabular-nums text-muted-foreground/60 w-8 text-right"
		>
			{store.timelineZoom.toFixed(1)}×
		</span>
	</div>
</div>
