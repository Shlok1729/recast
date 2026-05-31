<script lang="ts">
	import { formatBytes } from "$lib/dashboard/format";
	import { quotaStore } from "$lib/dashboard/store.svelte";
	import { HardDrive, Link2 } from "@lucide/svelte";

	// Reactive snapshot pulled from the layout-injected quota. When the
	// workspace plan is Enterprise (no cap) the bars render at 0% and the
	// limit row reads "Unlimited" — same component, no special path.
	const quota = $derived(quotaStore.value);

	const usedBytes = $derived(quota?.usage.storageBytes ?? 0);
	const storageLimit = $derived(quota?.limits.storageBytes ?? null);
	const storagePct = $derived(Math.round(quota?.storagePctUsed ?? 0));

	const activeRecasts = $derived(quota?.usage.activeRecastsCount ?? 0);
	const linksLimit = $derived(quota?.limits.activeRecasts ?? null);
	const linksPct = $derived(
		linksLimit && linksLimit > 0
			? Math.min(100, Math.round((activeRecasts / linksLimit) * 100))
			: 0,
	);

	const planLabel = $derived(
		quota?.plan === "pro"
			? "Pro"
			: quota?.plan === "enterprise"
				? "Enterprise"
				: "Free",
	);
</script>

<section class="glass-card flex flex-col gap-4 rounded-xl p-5">
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<HardDrive class="size-4 text-primary" />
			<h2 class="text-sm font-semibold text-foreground">Workspace usage</h2>
		</div>
		<span class="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border-low/40">
			{planLabel}
		</span>
	</div>

	<!-- Storage -->
	<div>
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-foreground">Storage</span>
			<span class="font-mono text-[11px] text-muted-foreground">
				{formatBytes(usedBytes)} / {storageLimit != null ? formatBytes(storageLimit) : "∞"}
			</span>
		</div>
		<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8">
			<div
				class="h-full rounded-full bg-linear-to-r from-primary/70 to-primary transition-[width] duration-700 ease-[cubic-bezier(0.625,0.05,0,1)]"
				style="width: {storagePct}%"
			></div>
		</div>
		<p class="mt-1.5 text-[11px] text-muted-foreground">
			{storageLimit == null
				? "Unlimited"
				: storagePct >= 100
					? "Cap reached — archive or upgrade"
					: `${100 - storagePct}% free`}
		</p>
	</div>

	<!-- Active links -->
	<div>
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-foreground">
				<Link2 class="-mt-0.5 mr-1 inline size-3 text-muted-foreground" />
				Active recasts
			</span>
			<span class="font-mono text-[11px] text-muted-foreground">
				{activeRecasts} / {linksLimit ?? "∞"}
			</span>
		</div>
		<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8">
			<div
				class="h-full rounded-full bg-linear-to-r from-tertiary/70 to-tertiary transition-[width] duration-700 ease-[cubic-bezier(0.625,0.05,0,1)]"
				style="width: {linksPct}%"
			></div>
		</div>
		<p class="mt-1.5 text-[11px] text-muted-foreground">
			{linksLimit == null
				? "Unlimited"
				: linksPct >= 100
					? "Limit reached"
					: `${linksLimit - activeRecasts} remaining`}
		</p>
	</div>
</section>
