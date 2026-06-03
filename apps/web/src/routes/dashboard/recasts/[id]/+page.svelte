<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import * as api from "$lib/dashboard/api";
	import {
		avgWatchPct,
		completionRate,
		uniqueViewers,
		viewCount,
		viewsByDay,
		watchRetention,
	} from "$lib/dashboard/activity";
	import ActivityBarChart from "$lib/dashboard/components/ActivityBarChart.svelte";
	import PageHeader from "$lib/dashboard/components/PageHeader.svelte";
	import PlayerDialog from "$lib/dashboard/components/PlayerDialog.svelte";
	import RangeTabs from "$lib/dashboard/components/RangeTabs.svelte";
	import RecastEngagement from "$lib/dashboard/components/RecastEngagement.svelte";
	import RecastShares, { type ShareRow } from "$lib/dashboard/components/RecastShares.svelte";
	import RecentActivity from "$lib/dashboard/components/RecentActivity.svelte";
	import StatGrid from "$lib/dashboard/components/StatGrid.svelte";
	import WatchRetention from "$lib/dashboard/components/WatchRetention.svelte";
	import { formatBytes, formatDuration, formatRelative } from "$lib/dashboard/format";
	import type { Recast } from "$lib/dashboard/store.svelte";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import {
		ArrowLeft,
		CheckCircle2,
		Cloud,
		Copy,
		Eye,
		MessageSquare,
		MonitorPlay,
		Percent,
		Play,
		Smile,
		Users,
	} from "@lucide/svelte";
	import { untrack } from "svelte";
	import { cubicOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	let { data } = $props();

	const recast = $derived(data.recast);

	// Local share list so revoke/create reflect immediately, re-seeded from the
	// loader on navigation / invalidateAll.
	let shares = $state<ShareRow[]>([]);
	$effect(() => {
		const next = data.shares;
		untrack(() => (shares = next));
	});

	let playing = $state(false);
	let creatingShare = $state(false);

	// ── Range (chart + retention only; the stat row is lifetime) ────────
	type Range = "7d" | "30d" | "all";
	let range = $state<Range>("7d");
	const rangeOptions = [
		{ label: "7 days", value: "7d" },
		{ label: "30 days", value: "30d" },
		{ label: "All", value: "all" },
	];
	const rangeDays = $derived(range === "7d" ? 7 : range === "30d" ? 30 : 365);
	const ranged = $derived(
		range === "all"
			? data.activity
			: data.activity.filter((a) => a.timestamp >= Date.now() - rangeDays * 86_400_000),
	);
	const chartData = $derived(viewsByDay(ranged, range === "7d" ? 7 : range === "30d" ? 14 : 30));
	const retention = $derived(watchRetention(ranged));

	// ── Lifetime stats ──────────────────────────────────────────────────
	const stats = $derived([
		{ icon: Eye, label: "Views", value: String(viewCount(data.activity)) },
		{ icon: Users, label: "Unique viewers", value: String(uniqueViewers(data.activity)) },
		{ icon: Percent, label: "Avg watch", value: `${avgWatchPct(data.activity)}%` },
		{ icon: CheckCircle2, label: "Completion", value: `${completionRate(data.activity)}%` },
		{ icon: MessageSquare, label: "Comments", value: String(data.engagement.commentCount) },
		{ icon: Smile, label: "Reactions", value: String(data.engagement.reactionCount) },
	]);

	const subtitle = $derived(
		`${formatDuration(recast.durationSec)} · ${formatBytes(recast.sizeBytes)} · ${formatRelative(recast.createdAt)}`,
	);

	// Player wants the store-shaped Recast.
	const playerRecast: Recast = $derived({
		id: recast.id,
		title: recast.title,
		durationSec: recast.durationSec,
		createdAt: recast.createdAt,
		sizeBytes: recast.sizeBytes,
		source: recast.source as Recast["source"],
		provider: recast.provider,
		views: viewCount(data.activity),
		folderId: null,
		tags: [],
		videoUrl: recast.videoUrl,
		posterUrl: recast.posterUrl ?? "",
		latestShareSlug: shares[0]?.slug ?? null,
	});

	async function copyLink() {
		try {
			let slug = shares[0]?.slug ?? null;
			if (!slug) {
				const { slug: newSlug } = await api.shareRecast(recast.id);
				slug = newSlug;
				await invalidateAll();
			}
			await navigator.clipboard.writeText(`${location.origin}/share/${slug}`);
			toast.success("Share link copied to clipboard.");
		} catch (e) {
			toast.error((e as Error)?.message ?? "Couldn't copy the link.");
		}
	}

	async function newShare() {
		if (creatingShare) return;
		creatingShare = true;
		try {
			await api.shareRecast(recast.id);
			await invalidateAll();
			toast.success("New share link created.");
		} catch (e) {
			toast.error((e as Error)?.message ?? "Couldn't create a link.");
		} finally {
			creatingShare = false;
		}
	}

	async function revokeShare(slug: string) {
		const snapshot = shares;
		shares = shares.filter((s) => s.slug !== slug);
		try {
			await api.deleteShare(slug);
			toast.success("Share link revoked.");
		} catch (e) {
			shares = snapshot;
			toast.error((e as Error)?.message ?? "Couldn't revoke the link.");
		}
	}
</script>

<svelte:head>
	<title>{recast.title} - Recast</title>
</svelte:head>

<a
	href="/dashboard/recasts"
	class="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
>
	<ArrowLeft class="size-3.5" />
	Library
</a>

<PageHeader title={recast.title} {subtitle}>
	<Button variant="outline" size="sm" class="gap-2" onclick={copyLink}>
		<Copy class="size-3.5" />
		Copy link
	</Button>
	<Button size="sm" class="gap-2" onclick={() => (playing = true)}>
		<Play class="size-3.5 fill-current" />
		Play
	</Button>
</PageHeader>

<!-- Poster strip -->
<button
	type="button"
	onclick={() => (playing = true)}
	aria-label="Play {recast.title}"
	class="group/hero relative mt-6 block aspect-video w-full overflow-hidden rounded-2xl bg-foreground/5 ring-1 ring-inset ring-border-low/40 sm:aspect-[21/9]"
	in:fly={{ y: 12, duration: 480, easing: cubicOut }}
>
	{#if recast.posterUrl}
		<img src={recast.posterUrl} alt="" class="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover/hero:scale-[1.02]" />
	{/if}
	<span class="absolute inset-0 grid place-items-center bg-background/25 transition-colors group-hover/hero:bg-background/35">
		<span class="grid size-14 place-items-center rounded-full bg-primary text-background shadow-craft-floating transition-transform duration-200 group-active/hero:scale-95">
			<Play class="size-6 translate-x-0.5 fill-current" />
		</span>
	</span>
	<span class="absolute left-3 top-3 flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset backdrop-blur-sm
		{recast.source === 'cloud' ? 'bg-primary/90 text-background ring-primary/40' : 'bg-background/85 text-muted-foreground ring-border-low/50'}">
		{#if recast.source === "cloud"}<Cloud class="size-3" />{recast.provider}{:else}<MonitorPlay class="size-3" />Local{/if}
	</span>
</button>

<!-- Lifetime stats -->
<div class="mt-6">
	<StatGrid {stats} class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" />
</div>

<!-- Views over time -->
<section class="mt-6">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-semibold text-foreground">Views over time</h2>
		<RangeTabs bind:value={range} options={rangeOptions} />
	</div>
	<ActivityBarChart data={chartData} />
</section>

<!-- Retention + engagement -->
<div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
	<WatchRetention data={retention} />
	<RecastEngagement engagement={data.engagement} />
</div>

<!-- Share links -->
<div class="mt-4">
	<RecastShares {shares} creating={creatingShare} onnew={newShare} onrevoke={revokeShare} />
</div>

<!-- Activity feed (this recast) -->
<div class="mt-4">
	<RecentActivity activity={data.activity} limit={12} linkHref={null} />
</div>

{#if playing}
	<PlayerDialog recast={playerRecast} onclose={() => (playing = false)} />
{/if}
