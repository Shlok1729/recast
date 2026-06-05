<script lang="ts" module>
	export type ShareRow = {
		slug: string;
		visibility: string;
		viewsCount: number;
		hasPassword: boolean;
		expiresAt: number | null;
		createdAt: number;
	};
</script>

<script lang="ts">
	import { browser } from "$app/environment";
	import { formatCount, formatRelative } from "$lib/dashboard/format";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import { Copy, ExternalLink, Globe, Lock, Plus, Share2, Trash2, UserCheck, Users } from "@lucide/svelte";

	let {
		shares,
		creating = false,
		onnew,
		onrevoke,
	}: {
		shares: ShareRow[];
		creating?: boolean;
		onnew: () => void;
		onrevoke: (slug: string) => void;
	} = $props();

	function scope(v: string): { label: string; icon: typeof Globe } {
		if (v === "public") return { label: "Anyone with the link", icon: Globe };
		if (v === "workspace" || v === "team") return { label: "Workspace", icon: Users };
		if (v === "selected") return { label: "Specific people", icon: UserCheck };
		return { label: "Private", icon: Lock };
	}

	async function copy(slug: string) {
		if (!browser) return;
		try {
			await navigator.clipboard.writeText(`${location.origin}/share/${slug}`);
			toast.success("Share link copied to clipboard.");
		} catch {
			toast.error("Couldn't copy the link.");
		}
	}
</script>

<section class="glass-card rounded-xl p-5">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Share2 class="size-4 text-primary" />
			<h2 class="text-sm font-semibold text-foreground">Share links</h2>
		</div>
		<Button variant="outline" size="sm" class="gap-1.5" disabled={creating} onclick={onnew}>
			<Plus class="size-3.5" />
			New link
		</Button>
	</header>

	{#if shares.length === 0}
		<p class="mt-4 text-xs text-muted-foreground">No share links yet. Create one to start sharing.</p>
	{:else}
		<ul class="mt-4 divide-y divide-border-low/40">
			{#each shares as s (s.slug)}
				{@const sc = scope(s.visibility)}
				<li class="flex flex-wrap items-center gap-3 py-3">
					<span class="glass-chip grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground">
						<sc.icon class="size-4" />
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<span class="truncate text-sm font-medium text-foreground">{sc.label}</span>
							{#if s.hasPassword}<Lock class="size-3 text-muted-foreground" />{/if}
						</div>
						<div class="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
							<span class="font-mono">/share/{s.slug}</span>
							<span aria-hidden="true">·</span>
							<span>{formatCount(s.viewsCount)} views</span>
							<span aria-hidden="true">·</span>
							<span>{formatRelative(s.createdAt)}</span>
							{#if s.expiresAt}
								<span aria-hidden="true">·</span>
								<span>expires {formatRelative(s.expiresAt)}</span>
							{/if}
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<Button variant="ghost" size="icon" class="size-8" aria-label="Copy link" onclick={() => copy(s.slug)}>
							<Copy class="size-3.5" />
						</Button>
						<a
							href={`/share/${s.slug}`}
							target="_blank"
							rel="noreferrer"
							aria-label="Open share page"
							class="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
						>
							<ExternalLink class="size-3.5" />
						</a>
						<Button
							variant="ghost"
							size="icon"
							class="size-8 text-muted-foreground hover:text-destructive"
							aria-label="Revoke link"
							onclick={() => onrevoke(s.slug)}
						>
							<Trash2 class="size-3.5" />
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
