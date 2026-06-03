<script lang="ts">
	import { TrendingDown } from "@lucide/svelte";

	// Watch-retention survival curve: share of plays that reached each decile of
	// the video. Shows WHERE viewers drop off, which an average watch % hides.
	let {
		data,
	}: {
		data: { pct: number; reached: number }[];
	} = $props();

	// The 50% mark is a useful "did they get past the intro" reference.
	const midpoint = $derived(data.find((d) => d.pct === 50)?.reached ?? 0);
</script>

<div class="glass-card rounded-xl p-5">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<TrendingDown class="size-4 text-primary" />
			<h2 class="text-sm font-semibold text-foreground">Watch retention</h2>
		</div>
		<span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
			{midpoint}% reach halfway
		</span>
	</header>

	<div class="mt-5 flex h-32 items-end gap-1.5">
		{#each data as d (d.pct)}
			{@const h = Math.max(2, d.reached)}
			<div class="group/bar relative flex h-full flex-1 flex-col items-center justify-end">
				<div
					class="w-full origin-bottom rounded-t-sm bg-linear-to-t from-primary/30 to-primary/80 ring-1 ring-inset ring-primary/10 transition-all duration-300 ease-[cubic-bezier(0.625,0.05,0,1)] group-hover/bar:from-primary/45 group-hover/bar:to-primary"
					style="height: {h}%"
				></div>
				<div
					class="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100"
				>
					{d.reached}%
				</div>
			</div>
		{/each}
	</div>

	<div class="mt-3 flex justify-between text-[10px] font-medium text-muted-foreground">
		{#each data as d (d.pct)}
			<span class="flex-1 text-center">{d.pct}%</span>
		{/each}
	</div>
</div>
