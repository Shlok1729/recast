<script lang="ts">
	import { avgWatchPct, uniqueViewers, viewsByDay } from "$lib/dashboard/activity";
	import ActivityBarChart from "$lib/dashboard/components/ActivityBarChart.svelte";
	import PageHeader from "$lib/dashboard/components/PageHeader.svelte";
	import RangeTabs from "$lib/dashboard/components/RangeTabs.svelte";
	import RecastPerformanceTable from "$lib/dashboard/components/RecastPerformanceTable.svelte";
	import RecentActivity from "$lib/dashboard/components/RecentActivity.svelte";
	import StatGrid from "$lib/dashboard/components/StatGrid.svelte";
	import { formatCount } from "$lib/dashboard/format";
	import { BarChart3, Eye, MessageSquare, Percent, Users } from "@lucide/svelte";
	import { cubicOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	let { data } = $props();

	let range = $state("7d");
	const rangeOptions = [
		{ label: "Last 7 days", value: "7d" },
		{ label: "Last 30 days", value: "30d" },
		{ label: "All time", value: "all" },
	];
	const days = $derived(range === "7d" ? 7 : range === "30d" ? 30 : 365);

	// Real viewer events from `share_view`, range-filtered.
	const activity = $derived(
		range === "all"
			? data.activity
			: data.activity.filter((a) => a.timestamp >= Date.now() - days * 86_400_000),
	);

	const totalViews = $derived(
		activity.filter((a) => a.kind === "viewed" || a.kind === "completed").length,
	);
	const chartData = $derived(viewsByDay(activity, range === "7d" ? 7 : range === "30d" ? 14 : 30));

	const stats = $derived([
		{ icon: Eye, label: "Views", value: formatCount(totalViews) },
		{ icon: Percent, label: "Avg watch", value: `${avgWatchPct(activity)}%` },
		{ icon: Users, label: "Unique viewers", value: formatCount(uniqueViewers(activity)) },
		{ icon: MessageSquare, label: "Comments", value: formatCount(data.commentsTotal) },
	]);
</script>

<svelte:head>
	<title>Analytics - Recast Dashboard</title>
</svelte:head>

<PageHeader icon={BarChart3} title="Analytics" subtitle="How your shared recasts are performing.">
	<RangeTabs bind:value={range} options={rangeOptions} />
</PageHeader>

<!-- Stats -->
<div class="mt-7">
	<StatGrid {stats} />
</div>

<!-- Views over time -->
<div class="mt-8" in:fly={{ y: 12, duration: 480, delay: 320, easing: cubicOut }}>
	<ActivityBarChart data={chartData} />
</div>

<!-- Per-recast performance (drill into each) -->
<div class="mt-4" in:fly={{ y: 12, duration: 480, delay: 400, easing: cubicOut }}>
	<RecastPerformanceTable rows={data.performance} />
</div>

<!-- Viewer activity (link omitted — already on analytics) -->
<div class="mt-4" in:fly={{ y: 12, duration: 480, delay: 480, easing: cubicOut }}>
	<RecentActivity {activity} limit={12} linkHref={null} />
</div>
