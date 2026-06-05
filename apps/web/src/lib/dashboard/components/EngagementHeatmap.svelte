<script lang="ts">
	import { engagementHeatmap, type EngagementMoment } from "$lib/dashboard/activity";
	import { formatDuration } from "$lib/dashboard/format";
	import { Flame } from "@lucide/svelte";

	// "Which moments did viewers actually react to" — reactions + comments
	// bucketed across the video's runtime. The tallest bar is the moment people
	// loved; hovering a bar shows its timestamp + split.
	let {
		moments,
		durationSec,
	}: {
		moments: EngagementMoment[];
		durationSec: number;
	} = $props();

	const heat = $derived(engagementHeatmap(moments, durationSec, 24));
	const totalReactions = $derived(moments.filter((m) => m.kind === "reaction").length);
	const totalComments = $derived(moments.filter((m) => m.kind === "comment").length);
</script>

<section class="glass-card rounded-xl p-5">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Flame class="size-4 text-primary" />
			<h2 class="text-sm font-semibold text-foreground">Engagement by moment</h2>
		</div>
		{#if heat.peakSec !== null && heat.max > 0}
			<span class="font-mono text-[11px] text-muted-foreground">
				Peak · <span class="font-semibold text-foreground">{formatDuration(heat.peakSec)}</span>
			</span>
		{/if}
	</header>

	{#if heat.max === 0}
		<p class="mt-4 text-xs text-muted-foreground">
			No reactions or comments yet — they'll show here pinned to the moment they happened.
		</p>
	{:else}
		<div class="mt-5 flex h-28 items-end gap-px">
			{#each heat.bins as b, i (i)}
				{@const h = Math.round((b.total / heat.max) * 100)}
				<div class="group/bar relative flex h-full flex-1 flex-col items-stretch justify-end">
					<!-- Comments stack on top of reactions within each slice. -->
					{#if b.total > 0}
						<div
							class="w-full rounded-t-[2px] bg-primary/35 transition-colors duration-200 group-hover/bar:bg-primary/55"
							style="height: {Math.round((b.comments / heat.max) * 100)}%"
						></div>
						<div
							class="w-full bg-primary/80 transition-colors duration-200 group-hover/bar:bg-primary"
							style="height: {Math.round((b.reactions / heat.max) * 100)}%"
						></div>
					{:else}
						<div class="h-px w-full bg-foreground/10" style="height: {Math.max(2, h)}%"></div>
					{/if}
					<div
						class="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100"
					>
						{formatDuration(b.startSec)} · {b.reactions}★ {b.comments}💬
					</div>
				</div>
			{/each}
		</div>

		<div class="mt-3 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
			<span>0:00</span>
			<div class="flex items-center gap-3">
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-[2px] bg-primary/80"></span>{totalReactions} reactions
				</span>
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-[2px] bg-primary/35"></span>{totalComments} comments
				</span>
			</div>
			<span>{formatDuration(durationSec)}</span>
		</div>
	{/if}
</section>
