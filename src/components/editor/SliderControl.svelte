<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		icon?: Snippet;
		unit?: string;
		onchange?: (value: number) => void;
	}

	let {
		label,
		value = $bindable(),
		min = 0,
		max = 100,
		step = 1,
		icon,
		unit = '',
		onchange,
	}: Props = $props();

	let trackEl: HTMLDivElement | undefined = $state();
	let isDragging = $state(false);

	const percentage = $derived(((value - min) / (max - min)) * 100);

	function handlePointerDown(e: PointerEvent) {
		isDragging = true;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		updateFromPointer(e);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		updateFromPointer(e);
	}

	function handlePointerUp() {
		isDragging = false;
	}

	function updateFromPointer(e: PointerEvent) {
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		const ratio = x / rect.width;
		const raw = min + ratio * (max - min);
		const stepped = Math.round(raw / step) * step;
		const clamped = Math.max(min, Math.min(max, stepped));
		value = clamped;
		onchange?.(clamped);
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
			{#if icon}
				{@render icon()}
			{/if}
			{label}
		</div>
		<span class="text-[11px] font-mono tabular-nums text-muted-foreground/70">
			{value}{unit}
		</span>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={trackEl}
		class="slider-track group relative h-2 w-full cursor-pointer rounded-full bg-muted"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		role="slider"
		tabindex={0}
		aria-valuenow={value}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-label={label}
	>
		<!-- Fill -->
		<div
			class="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-[width] duration-75"
			style="width: {percentage}%"
		></div>

		<!-- Thumb -->
		<div
			class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform duration-100"
			style="left: {percentage}%"
		>
			<div
				class="h-4 w-4 rounded-full border-2 border-primary bg-background shadow-md transition-transform duration-150
					{isDragging ? 'scale-125 shadow-lg shadow-primary/20' : 'group-hover:scale-110'}"
			></div>
		</div>
	</div>
</div>
