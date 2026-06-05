<script lang="ts">
	import type { Component } from "svelte";
	import StatCard from "./StatCard.svelte";
	import { cubicOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	// Staggered row of StatCards. Pulls the repeated `{#each stats}` + per-item
	// fly stagger out of the home and library pages into one place.
	let {
		stats,
		class: className = "grid grid-cols-2 gap-3 lg:grid-cols-4",
	}: {
		stats: { icon: Component<{ class?: string }>; label: string; value: string }[];
		class?: string;
	} = $props();
</script>

<div class={className}>
	{#each stats as stat, i (stat.label)}
		<div in:fly={{ y: 12, duration: 480, delay: 80 + i * 60, easing: cubicOut }}>
			<StatCard icon={stat.icon} label={stat.label} value={stat.value} />
		</div>
	{/each}
</div>
