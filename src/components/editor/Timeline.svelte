<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import { Search, X } from "@lucide/svelte";
	import { onMount } from "svelte";

	interface Props {
		store: EditorStore;
		videoEl?: HTMLVideoElement | null;
	}

	let { store, videoEl = null }: Props = $props();

	let timelineEl: HTMLDivElement | undefined = $state();
	let rulerEl: HTMLDivElement | undefined = $state();
	let isDraggingPlayhead = $state(false);
	let timelineWidth = $state(800);

	const duration = $derived(store.metadata?.duration ?? 0);
	const pixelsPerSecond = $derived(
		duration > 0 ? (timelineWidth * store.timelineZoom) / duration : 100,
	);
	const totalWidth = $derived(duration * pixelsPerSecond);
	const playheadLeft = $derived(store.currentTime * pixelsPerSecond);

	// Generate time markers
	const timeMarkers = $derived.by(() => {
		if (duration <= 0) return [];
		const markers: { time: number; label: string; major: boolean }[] = [];

		// Determine interval based on zoom
		let interval = 1;
		if (pixelsPerSecond < 50) interval = 5;
		if (pixelsPerSecond < 20) interval = 10;
		if (pixelsPerSecond > 150) interval = 0.5;

		for (let t = 0; t <= duration; t += interval) {
			const mins = Math.floor(t / 60);
			const secs = Math.floor(t % 60);
			markers.push({
				time: t,
				label: `${mins}:${secs.toString().padStart(2, "0")}`,
				major: t % (interval * 2) === 0 || interval >= 5,
			});
		}
		return markers;
	});

	// Sub-tick marks between major markers
	const tickMarks = $derived.by(() => {
		if (duration <= 0) return [];
		const ticks: number[] = [];
		const tickInterval = pixelsPerSecond > 100 ? 0.25 : 0.5;
		for (let t = 0; t <= duration; t += tickInterval) {
			ticks.push(t);
		}
		return ticks;
	});

	function seekToPosition(clientX: number) {
		if (!timelineEl) return;
		const rect = timelineEl.getBoundingClientRect();
		const scrollLeft = timelineEl.scrollLeft;
		const x = clientX - rect.left + scrollLeft;
		const time = Math.max(0, Math.min(duration, x / pixelsPerSecond));
		store.currentTime = time;
		if (videoEl) videoEl.currentTime = time;
	}

	function handleTimelinePointerDown(e: PointerEvent) {
		isDraggingPlayhead = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		seekToPosition(e.clientX);
	}

	function handleTimelinePointerMove(e: PointerEvent) {
		if (!isDraggingPlayhead) return;
		seekToPosition(e.clientX);
	}

	function handleTimelinePointerUp() {
		isDraggingPlayhead = false;
	}

	function handleResize() {
		if (!timelineEl) return;
		timelineWidth = timelineEl.clientWidth;
	}

	onMount(() => {
		handleResize();
		const ro = new ResizeObserver(handleResize);
		if (timelineEl) ro.observe(timelineEl);
		return () => ro.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col border-t border-border bg-card/20 backdrop-blur-sm select-none px-3"
>
	<!-- Timeline content -->
	<div
		bind:this={timelineEl}
		class="relative overflow-x-auto overflow-y-hidden custom-scrollbar h-48"
		onpointerdown={handleTimelinePointerDown}
		onpointermove={handleTimelinePointerMove}
		onpointerup={handleTimelinePointerUp}
		onpointercancel={handleTimelinePointerUp}
	>
		<div
			class="relative min-w-full h-full"
			style="width: {totalWidth}px;"
		>
			<!-- Ruler -->
			<div class="relative h-7 border-b border-border/50">
				{#each timeMarkers as marker}
					<div
						class="absolute top-0 flex flex-col items-center"
						style="left: {marker.time * pixelsPerSecond}px"
					>
						<span
							class="text-[10px] font-mono tabular-nums text-muted-foreground/60 mt-1"
						>
							{marker.label}
						</span>
						<div
							class="w-px bg-border/40"
							style="height: {marker.major ? '8px' : '4px'}"
						></div>
					</div>
				{/each}

				<!-- Sub-ticks -->
				{#each tickMarks as tick}
					<div
						class="absolute bottom-0 w-px h-1 bg-border/20"
						style="left: {tick * pixelsPerSecond}px"
					></div>
				{/each}
			</div>

			<!-- Playhead -->
			<div
				class="absolute top-0 z-30 transition-[left] {isDraggingPlayhead
					? 'duration-0'
					: 'duration-75'}"
				style="left: {playheadLeft}px"
			>
				<!-- Head -->
				<div class="relative -translate-x-1/2">
					<div
						class="mx-auto h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
					></div>
					<div
						class="mx-auto h-full w-px bg-red-500/80"
						style="height: 172px;"
					></div>
				</div>
			</div>

			<!-- Clip track -->
			<div
				class="absolute left-0 right-0 px-0"
				style="top: 34px; height: 40px;"
			>
				<div
					class="relative h-full rounded-lg overflow-hidden"
					style="left: {store.trimStart *
						pixelsPerSecond}px; width: {((store.trimEnd ||
						duration) -
						store.trimStart) *
						pixelsPerSecond}px"
				>
					<!-- Background gradient -->
					<div
						class="absolute inset-0 bg-linear-to-r from-blue-500 to-blue-400 opacity-80"
					></div>

					<!-- Label -->
					<div
						class="relative flex h-full items-center justify-center gap-1.5"
					>
						<span class="text-[11px] font-semibold text-white"
							>Clip</span
						>
						<span
							class="flex items-center gap-0.5 text-[10px] text-white/70"
						>
							⏱ {(
								(store.trimEnd || duration) - store.trimStart
							).toFixed(1)}s
						</span>
					</div>

					<!-- Drag handles -->
					<div
						class="absolute left-0 top-0 h-full w-2 cursor-col-resize bg-blue-600/50 hover:bg-blue-600/80 transition-colors"
					></div>
					<div
						class="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-blue-600/50 hover:bg-blue-600/80 transition-colors"
					></div>
				</div>
			</div>

			<!-- Zoom regions -->
			{#each store.zoomRegions as region, i}
				<div
					class="absolute rounded-lg overflow-hidden group"
					style="
						left: {region.start * pixelsPerSecond}px;
						width: {(region.end - region.start) * pixelsPerSecond}px;
						top: {84 + i * 44}px;
						height: 36px;
					"
				>
					<div
						class="absolute inset-0 bg-muted/80 border border-border rounded-lg"
					></div>
					<div
						class="relative flex h-full items-center justify-center gap-2"
					>
						<span class="text-[11px] font-medium text-foreground"
							>Zoom</span
						>
						<span
							class="flex items-center gap-0.5 text-[10px] text-muted-foreground"
						>
							<Search size={10} />
							{region.scale}×
						</span>

						<!-- Remove button -->
						<button
							onclick={(e) => {
								e.stopPropagation();
								store.removeZoomRegion(region.id);
							}}
							class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive/80 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-destructive"
						>
							<X size={8} strokeWidth={3} />
						</button>
					</div>

					<!-- Drag handles -->
					<div
						class="absolute left-0 top-0 h-full w-2 cursor-col-resize bg-border/50 hover:bg-border transition-colors rounded-l-lg"
					></div>
					<div
						class="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-border/50 hover:bg-border transition-colors rounded-r-lg"
					></div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		height: 5px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: var(--muted);
		border-radius: 100px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: var(--muted-foreground);
	}
</style>
