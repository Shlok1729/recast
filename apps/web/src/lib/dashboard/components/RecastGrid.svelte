<script lang="ts">
	import type { Folder, Tag } from "$lib/dashboard/library.svelte";
	import type { Recast } from "$lib/dashboard/store.svelte";
	import EmptyState from "./EmptyState.svelte";
	import RecastCard from "./RecastCard.svelte";
	import { Button } from "@recast/ui/button";
	import { Film, LoaderCircle, Upload } from "@lucide/svelte";
	import { flip } from "svelte/animate";
	import { cubicOut } from "svelte/easing";
	import { scale } from "svelte/transition";

	// Responsive recast grid + its three empty states (no recasts / no match /
	// empty folder). Extracted from the library page so the page keeps only the
	// data + handlers.
	let {
		recasts,
		folders,
		tags,
		selectedIds = new Set<string>(),
		selectionMode = false,
		hasAnyRecasts,
		filtersActive,
		uploading = false,
		uploadLabel = "",
		onplay,
		onrename,
		oncopylink,
		ontogglesource,
		onmove,
		ontoggletag,
		ondelete,
		onToggleSelect,
		onupload,
		onclearfilters,
	}: {
		recasts: Recast[];
		folders: Folder[];
		tags: Tag[];
		selectedIds?: Set<string>;
		selectionMode?: boolean;
		hasAnyRecasts: boolean;
		filtersActive: boolean;
		uploading?: boolean;
		uploadLabel?: string;
		onplay: (rec: Recast) => void;
		onrename: (rec: Recast) => void;
		oncopylink: (rec: Recast) => void;
		ontogglesource: (rec: Recast) => void;
		onmove: (rec: Recast, folderId: string | null) => void;
		ontoggletag: (rec: Recast, tagId: string) => void;
		ondelete: (rec: Recast) => void;
		onToggleSelect: (rec: Recast) => void;
		onupload: () => void;
		onclearfilters: () => void;
	} = $props();
</script>

{#if recasts.length > 0}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each recasts as rec (rec.id)}
			<div
				animate:flip={{ duration: 320, easing: cubicOut }}
				in:scale={{ start: 0.97, duration: 300, easing: cubicOut }}
				out:scale={{ start: 0.97, duration: 170, easing: cubicOut }}
			>
				<RecastCard
					recast={rec}
					{folders}
					{tags}
					selectable
					selected={selectedIds.has(rec.id)}
					{selectionMode}
					onToggleSelect={() => onToggleSelect(rec)}
					onplay={() => onplay(rec)}
					onrename={() => onrename(rec)}
					oncopylink={() => oncopylink(rec)}
					ontogglesource={() => ontogglesource(rec)}
					onmove={(folderId) => onmove(rec, folderId)}
					ontoggletag={(tagId) => ontoggletag(rec, tagId)}
					ondelete={() => ondelete(rec)}
				/>
			</div>
		{/each}
	</div>
{:else if !hasAnyRecasts}
	<EmptyState icon={Film} title="No recasts yet" description="Upload an MP4, or capture and export one with the Recast desktop app.">
		<Button size="sm" class="gap-2" disabled={uploading} onclick={onupload}>
			{#if uploading}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Upload class="size-3.5" />{/if}
			{uploading ? uploadLabel : "Upload recast"}
		</Button>
	</EmptyState>
{:else if filtersActive}
	<EmptyState icon={Film} title="No recasts match" description="Nothing here matches your search, folder, and tag filters.">
		<Button variant="outline" size="sm" onclick={onclearfilters}>Clear filters</Button>
	</EmptyState>
{:else}
	<EmptyState icon={Film} title="This folder is empty" description="Drag a recast onto it, or use “Move to” from a recast's menu." />
{/if}
