<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		description?: string;
		icon?: Snippet;
		unit?: string;
		disabled?: boolean;
		onstart?: () => void;
		onchange?: (value: number) => void;
		oncommit?: (value: number) => void;
		formatValue?: (value: number, unit: string) => string;
	}

	let {
		label,
		value = $bindable(),
		min = 0,
		max = 100,
		step = 1,
		description,
		icon,
		unit = "",
		disabled = false,
		onstart,
		onchange,
		oncommit,
		formatValue,
	}: Props = $props();

	let trackEl: HTMLDivElement | null = $state(null);
	let isDragging = $state(false);
	let activePointerId = $state<number | null>(null);

	function getStepPrecision(input: number) {
		if (!Number.isFinite(input)) return 0;
		const parts = input.toString().split(".");
		return parts[1]?.length ?? 0;
	}

	const precision = $derived(getStepPrecision(step));
	const percentage = $derived.by(() => {
		if (max <= min) return 0;
		return ((value - min) / (max - min)) * 100;
	});

	function defaultFormatValue(nextValue: number, nextUnit: string) {
		const formatted =
			precision > 0 ? nextValue.toFixed(precision) : `${Math.round(nextValue)}`;
		return `${formatted}${nextUnit}`;
	}

	const formattedValue = $derived(
		(formatValue ?? defaultFormatValue)(value, unit),
	);

	function normalizeValue(nextValue: number) {
		if (max <= min) return min;
		const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
		const stepped =
			min + Math.round((nextValue - min) / safeStep) * safeStep;
		const clamped = Math.min(max, Math.max(min, stepped));
		return Number(clamped.toFixed(precision));
	}

	function commitValue(nextValue: number, shouldCommit = false) {
		const normalized = normalizeValue(nextValue);
		const changed = normalized !== value;

		if (changed) {
			value = normalized;
			onchange?.(normalized);
		}

		if (shouldCommit) {
			oncommit?.(normalized);
		}
	}

	function updateFromPointer(event: PointerEvent, shouldCommit = false) {
		if (!trackEl || disabled) return;
		const rect = trackEl.getBoundingClientRect();
		if (rect.width <= 0) return;

		const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
		const ratio = offsetX / rect.width;
		const nextValue = min + ratio * (max - min);
		commitValue(nextValue, shouldCommit);
	}

	function handlePointerDown(event: PointerEvent) {
		if (disabled || !trackEl) return;
		event.preventDefault();
		onstart?.();
		isDragging = true;
		activePointerId = event.pointerId;
		trackEl.setPointerCapture(event.pointerId);
		updateFromPointer(event);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isDragging || disabled) return;
		if (activePointerId !== null && event.pointerId !== activePointerId) return;
		updateFromPointer(event);
	}

	function finishPointerInteraction(event?: PointerEvent) {
		if (!isDragging) return;
		if (event && activePointerId !== null && event.pointerId !== activePointerId) {
			return;
		}

		if (event) {
			updateFromPointer(event, true);
		} else {
			oncommit?.(normalizeValue(value));
		}

		isDragging = false;
		activePointerId = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled) return;

		const pageStep = step * 10;
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowDown":
				event.preventDefault();
				onstart?.();
				commitValue(value - step, true);
				break;
			case "ArrowRight":
			case "ArrowUp":
				event.preventDefault();
				onstart?.();
				commitValue(value + step, true);
				break;
			case "PageDown":
				event.preventDefault();
				onstart?.();
				commitValue(value - pageStep, true);
				break;
			case "PageUp":
				event.preventDefault();
				onstart?.();
				commitValue(value + pageStep, true);
				break;
			case "Home":
				event.preventDefault();
				onstart?.();
				commitValue(min, true);
				break;
			case "End":
				event.preventDefault();
				onstart?.();
				commitValue(max, true);
				break;
		}
	}
</script>

<div
	class="rounded-2xl border border-border/70 bg-background/70 p-3 shadow-[0_1px_0_rgba(255,255,255,0.4)_inset] transition-colors duration-200 {disabled
		? 'opacity-60'
		: 'hover:border-border'}"
>
	<div class="mb-3 flex items-start justify-between gap-3">
		<div class="min-w-0">
			<div
				class="flex items-center gap-1.5 text-xs font-semibold tracking-[0.02em] text-foreground"
			>
				{#if icon}
					<span class="text-muted-foreground">
						{@render icon()}
					</span>
				{/if}
				<span class="truncate">{label}</span>
			</div>
			{#if description}
				<p class="mt-1 text-[11px] leading-4 text-muted-foreground">
					{description}
				</p>
			{/if}
		</div>

		<span
			class="shrink-0 rounded-full border border-border/70 bg-muted/60 px-2 py-1 text-[11px] font-medium tabular-nums text-foreground/80"
		>
			{formattedValue}
		</span>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={trackEl}
		class="group relative h-2.5 w-full rounded-full bg-muted/80 {disabled
			? 'cursor-not-allowed'
			: 'cursor-pointer'}"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={finishPointerInteraction}
		onpointercancel={finishPointerInteraction}
		onlostpointercapture={() => finishPointerInteraction()}
		onkeydown={handleKeydown}
		role="slider"
		tabindex={disabled ? -1 : 0}
		aria-disabled={disabled}
		aria-valuenow={value}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuetext={formattedValue}
		aria-label={label}
	>
		<div
			class="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-primary via-primary to-blue-400 transition-[width] duration-100"
			style="width: {Math.min(100, Math.max(0, percentage))}%"
		></div>

		<div
			class="pointer-events-none absolute top-1/2 -translate-y-1/2 transition-[left] duration-100"
			style="left: calc({Math.min(100, Math.max(0, percentage))}% - 0.5rem)"
		>
			<div
				class="flex h-4 w-4 items-center justify-center rounded-full border border-white/80 bg-background shadow-[0_6px_18px_rgba(37,99,235,0.25)] ring-4 ring-primary/10 transition-transform duration-150 {isDragging
					? 'scale-110'
					: 'group-hover:scale-105 group-focus-visible:scale-105'}"
			>
				<div class="h-1.5 w-1.5 rounded-full bg-primary"></div>
			</div>
		</div>
	</div>
</div>
