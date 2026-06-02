<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import * as api from "$lib/dashboard/api";
	import ArchivedCard, { type ArchivedRecast } from "$lib/dashboard/components/ArchivedCard.svelte";
	import FolderRail, { type FolderSelection } from "$lib/dashboard/components/FolderRail.svelte";
	import PlayerDialog from "$lib/dashboard/components/PlayerDialog.svelte";
	import RecastCard from "$lib/dashboard/components/RecastCard.svelte";
	import RenameDialog from "$lib/dashboard/components/RenameDialog.svelte";
	import StatCard from "$lib/dashboard/components/StatCard.svelte";
	import TagManagerDialog from "$lib/dashboard/components/TagManagerDialog.svelte";
	import { focusOnMount } from "$lib/dashboard/focus";
	import { formatBytes } from "$lib/dashboard/format";
	import { foldersStore, tagsStore } from "$lib/dashboard/library.svelte";
	import {
	  recastsStore,
	  type Recast,
	  type RecordingSource,
	} from "$lib/dashboard/store.svelte";
	import { UPLOAD_ACCEPT, uploadRecastFile, type UploadPhase } from "$lib/dashboard/upload";
	import { Archive, Cloud, Film, FolderOpen, HardDrive, Library, LoaderCircle, Plus, Search, Settings2, Upload, Video, X } from "@lucide/svelte";
	import { Button } from "@recast/ui/button";
	import { Chip } from "@recast/ui/chip";
	import * as Select from "@recast/ui/select";
	import { toast } from "@recast/ui/sonner";
	import { untrack } from "svelte";
	import { flip } from "svelte/animate";
	import { cubicOut } from "svelte/easing";
	import { fly, scale, slide } from "svelte/transition";

	let { data } = $props();

	// Hydrate recasts + folders + tags from the server.
	$effect(() => {
		const mapped = data.recasts.map((r) => ({
			id: r.id,
			title: r.title,
			durationSec: r.durationSec,
			createdAt: r.createdAt,
			sizeBytes: r.sizeBytes,
			source: r.source as Recast["source"],
			provider: r.provider,
			views: r.views,
			folderId: r.folderId ?? null,
			tags: r.tags ?? [],
			videoUrl: r.videoUrl,
			posterUrl: r.posterUrl ?? "",
		}));
		const folders = data.folders;
		const tags = data.tags;
		untrack(() => {
			recastsStore.hydrate(mapped);
			foldersStore.hydrate(folders);
			tagsStore.hydrate(tags);
		});
	});

	const workspaceId = $derived(data.workspaceId);

	// Archived recasts live in their own tab. Keep a local copy so a delete can
	// drop the card optimistically; re-seed whenever the loader returns fresh
	// data (e.g. after invalidateAll()).
	let archived = $state<ArchivedRecast[]>([]);
	$effect(() => {
		const next = data.archived;
		untrack(() => (archived = next));
	});

	type View = "library" | "archived";
	let view = $state<View>("library");

	type SortKey = "recent" | "oldest" | "name" | "largest";

	let query = $state("");
	let activeFilter = $state<RecordingSource | "all">("all");
	let sortKey = $state<string>("recent");
	let selectedFolder = $state<FolderSelection>("all");
	let selectedTagIds = $state<string[]>([]);

	let playing = $state<Recast | null>(null);
	let renaming = $state<Recast | null>(null);
	let uploading = $state(false);
	let uploadPhase = $state<UploadPhase>("preparing");
	let uploadPct = $state(0);
	let fileInput = $state<HTMLInputElement | null>(null);

	const uploadLabel = $derived(
		uploadPhase === "uploading"
			? `Uploading ${uploadPct}%`
			: uploadPhase === "finalizing"
				? "Finalizing…"
				: uploadPhase === "sharing"
					? "Creating link…"
					: "Preparing…",
	);

	// Inline tag creation in the filter bar.
	let creatingTag = $state(false);
	let newTagName = $state("");
	let managingTags = $state(false);

	const filters: { label: string; value: RecordingSource | "all" }[] = [
		{ label: "All", value: "all" },
		{ label: "Cloud", value: "cloud" },
		{ label: "Local", value: "local" },
	];

	const sorts: { label: string; value: SortKey }[] = [
		{ label: "Newest first", value: "recent" },
		{ label: "Oldest first", value: "oldest" },
		{ label: "Name (A–Z)", value: "name" },
		{ label: "Largest first", value: "largest" },
	];

	function matchesFolder(r: Recast): boolean {
		if (selectedFolder === "all") return true;
		if (selectedFolder === "root") return !r.folderId;
		return r.folderId === selectedFolder;
	}
	// Tag filter is OR — show recasts carrying ANY of the selected tags.
	function matchesTags(r: Recast): boolean {
		if (selectedTagIds.length === 0) return true;
		return selectedTagIds.some((id) => r.tags.includes(id));
	}

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = recastsStore.items.filter(
			(r) =>
				(activeFilter === "all" || r.source === activeFilter) &&
				matchesFolder(r) &&
				matchesTags(r) &&
				r.title.toLowerCase().includes(q),
		);
		return [...list].sort((a, b) => {
			switch (sortKey) {
				case "oldest":
					return a.createdAt - b.createdAt;
				case "name":
					return a.title.localeCompare(b.title);
				case "largest":
					return b.sizeBytes - a.sizeBytes;
				default:
					return b.createdAt - a.createdAt;
			}
		});
	});

	const stats = $derived([
		{ icon: Video, label: "Recasts", value: String(recastsStore.items.length) },
		{ icon: HardDrive, label: "Storage used", value: formatBytes(recastsStore.usedBytes) },
		{ icon: Cloud, label: "On cloud", value: String(recastsStore.cloudCount) },
	]);

	const hasRecasts = $derived(recastsStore.items.length > 0);
	const filtersActive = $derived(
		query.trim() !== "" || activeFilter !== "all" || selectedFolder !== "all" || selectedTagIds.length > 0,
	);
	const sortLabel = $derived(sorts.find((s) => s.value === sortKey)?.label ?? "Sort");
	const folderCrumb = $derived(
		typeof selectedFolder === "string" && selectedFolder !== "all" && selectedFolder !== "root"
			? foldersStore.breadcrumb(selectedFolder)
			: [],
	);

	function clearFilters() {
		query = "";
		activeFilter = "all";
		selectedFolder = "all";
		selectedTagIds = [];
	}

	function toggleTagFilter(id: string) {
		selectedTagIds = selectedTagIds.includes(id)
			? selectedTagIds.filter((t) => t !== id)
			: [...selectedTagIds, id];
	}

	async function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		uploadPhase = "preparing";
		uploadPct = 0;
		try {
			const result = await uploadRecastFile(file, {
				workspaceId,
				onPhase: (p) => (uploadPhase = p),
				onProgress: (pct) => (uploadPct = pct),
			});
			// Pull the real, server-published recast into the list (with its
			// share slug, poster, signed-on-read video, etc.).
			await invalidateAll();
			let copied = false;
			try {
				await navigator.clipboard.writeText(result.shareUrl);
				copied = true;
			} catch {
				copied = false;
			}
			toast.success(
				copied
					? `“${file.name}” uploaded — share link copied to clipboard.`
					: `“${file.name}” uploaded and shared.`,
			);
		} catch (err) {
			toast.error((err as Error)?.message ?? "Couldn't upload that file.");
		} finally {
			uploading = false;
			input.value = "";
		}
	}

	async function doRename(rec: Recast, title: string) {
		renaming = null;
		const prev = rec.title;
		recastsStore.rename(rec.id, title);
		try {
			await api.renameRecast(rec.id, title);
			toast.success("Recast renamed.");
		} catch (e) {
			recastsStore.rename(rec.id, prev);
			toast.error((e as Error)?.message ?? "Couldn't rename.");
		}
	}

	function toggleSource(rec: Recast) {
		// Local-only concept in the dashboard mock; the real cloud upload is the
		// desktop "Share to Cloud" flow.
		const next: RecordingSource = rec.source === "cloud" ? "local" : "cloud";
		recastsStore.setSource(rec.id, next);
		toast.success(next === "cloud" ? "Uploaded to Cloudinary." : "Moved to local storage.");
	}

	async function moveRecast(rec: Recast, folderId: string | null) {
		if (rec.folderId === folderId) return;
		const prev = rec.folderId;
		recastsStore.move(rec.id, folderId);
		try {
			await api.moveRecast(rec.id, folderId);
			const name = folderId ? foldersStore.get(folderId)?.name ?? "folder" : "No folder";
			toast.success(`Moved to ${name}.`);
		} catch (e) {
			recastsStore.move(rec.id, prev);
			toast.error((e as Error)?.message ?? "Couldn't move recast.");
		}
	}

	async function toggleTag(rec: Recast, tagId: string) {
		const prev = rec.tags;
		const next = prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId];
		recastsStore.setTags(rec.id, next);
		try {
			await api.setRecastTags(rec.id, next);
		} catch (e) {
			recastsStore.setTags(rec.id, prev);
			toast.error((e as Error)?.message ?? "Couldn't update tags.");
		}
	}

	async function copyLink(rec: Recast) {
		try {
			await navigator.clipboard.writeText(`https://recast.li/share/${rec.id}`);
			toast.success("Share link copied to clipboard.");
		} catch {
			toast.error("Couldn't access the clipboard.");
		}
	}

	async function deleteRecast(rec: Recast) {
		const snapshot = recastsStore.items;
		recastsStore.remove(rec.id);
		if (playing?.id === rec.id) playing = null;
		try {
			await api.deleteRecast(rec.id);
			toast.success(`“${rec.title}” deleted.`);
		} catch (e) {
			recastsStore.hydrate(snapshot); // restore
			toast.error((e as Error)?.message ?? "Couldn't delete recast.");
		}
	}

	async function deleteArchived(rec: ArchivedRecast) {
		const snapshot = archived;
		archived = archived.filter((a) => a.id !== rec.id);
		try {
			await api.deleteRecast(rec.id);
			toast.success(`“${rec.title}” deleted permanently.`);
		} catch (e) {
			archived = snapshot; // restore
			toast.error((e as Error)?.message ?? "Couldn't delete recast.");
		}
	}

	async function createTag() {
		const name = newTagName.trim();
		creatingTag = false;
		newTagName = "";
		if (!name) return;
		try {
			const tag = await api.createTag({ workspaceId, name });
			tagsStore.add(tag);
		} catch (e) {
			toast.error((e as Error)?.message ?? "Couldn't create tag.");
		}
	}
</script>

<svelte:head>
	<title>Recasts - Recast Dashboard</title>
</svelte:head>

<input bind:this={fileInput} type="file" accept={UPLOAD_ACCEPT} class="hidden" onchange={onFilePicked} />

<!-- Header -->
<header
	class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
	in:fly={{ y: 12, duration: 500, easing: cubicOut }}
>
	<div>
		<h1 class="text-2xl font-semibold tracking-tight text-foreground">Recasts</h1>
		<p class="mt-1 text-sm text-muted-foreground">All your recasts — captured, uploaded, shared.</p>
	</div>
	<Button class="gap-2" disabled={uploading} onclick={() => fileInput?.click()}>
		{#if uploading}<LoaderCircle class="size-4 animate-spin" />{:else}<Upload class="size-4" />{/if}
		{uploading ? uploadLabel : "Upload recast"}
	</Button>
</header>

<!-- Stats -->
<div class="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
	{#each stats as stat, i (stat.label)}
		<div in:fly={{ y: 12, duration: 480, delay: 80 + i * 70, easing: cubicOut }}>
			<StatCard icon={stat.icon} label={stat.label} value={stat.value} />
		</div>
	{/each}
</div>

<!-- View tabs: Library / Archived -->
<div class="mt-8 flex items-center gap-1 border-b border-border-low/60" in:fly={{ y: 12, duration: 480, delay: 200, easing: cubicOut }}>
	<button
		type="button"
		onclick={() => (view = "library")}
		class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors
			{view === 'library' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
	>
		<Library class="size-4" />
		Library
	</button>
	<button
		type="button"
		onclick={() => (view = "archived")}
		class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors
			{view === 'archived' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
	>
		<Archive class="size-4" />
		Archived
		{#if archived.length > 0}
			<span class="rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">{archived.length}</span>
		{/if}
	</button>
</div>

{#if view === "library"}
<!-- Library: folder rail + content -->
<div class="mt-6 flex flex-col gap-6 lg:flex-row" in:fly={{ y: 12, duration: 480, delay: 80, easing: cubicOut }}>
	<FolderRail
		{workspaceId}
		selected={selectedFolder}
		onselect={(s) => (selectedFolder = s)}
		onDropRecast={(recastId, folderId) => {
			const rec = recastsStore.items.find((r) => r.id === recastId);
			if (rec) moveRecast(rec, folderId);
		}}
	/>

	<div class="min-w-0 flex-1">
		<!-- Toolbar -->
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex items-center gap-2 rounded-lg border border-border-low/70 bg-card/50 px-3 py-2 backdrop-blur-sm lg:w-72">
				<Search class="size-4 shrink-0 text-muted-foreground" />
				<input
					type="text"
					bind:value={query}
					placeholder="Search recasts…"
					class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
				/>
				{#if query}
					<button type="button" onclick={() => (query = "")} aria-label="Clear search" class="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground">
						<X class="size-3.5" />
					</button>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<div class="flex items-center gap-1 rounded-lg border border-border-low/60 bg-card/40 p-1">
					{#each filters as f (f.value)}
						<button
							type="button"
							onclick={() => (activeFilter = f.value)}
							class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200
								{activeFilter === f.value ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:text-foreground'}"
						>
							{f.label}
						</button>
					{/each}
				</div>

				<Select.Root type="single" bind:value={sortKey}>
					<Select.Trigger aria-label="Sort recasts" class="w-40 border-border-low/60 bg-card/40 text-xs font-semibold hover:border-border-low">
						{sortLabel}
					</Select.Trigger>
					<Select.Content class="p-1">
						{#each sorts as s (s.value)}
							<Select.Item value={s.value} label={s.label}>{s.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<!-- Tag filter chips -->
		<div class="mt-3 flex flex-wrap items-center gap-1.5">
			{#each tagsStore.sorted as t (t.id)}
				<Chip
					label={t.name}
					color={t.color}
					selected={selectedTagIds.includes(t.id)}
					onclick={() => toggleTagFilter(t.id)}
				/>
			{/each}
			{#if creatingTag}
				<input
					bind:value={newTagName}
					onblur={createTag}
					onkeydown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							creatingTag = false;
							newTagName = "";
						}
					}}
					placeholder="Tag name"
					class="h-7 w-28 rounded-full border border-primary/50 bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground/60"
					use:focusOnMount
				/>
			{:else}
				<button
					type="button"
					onclick={() => (creatingTag = true)}
					class="inline-flex items-center gap-1 rounded-full border border-dashed border-border-low/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
				>
					<Plus class="size-3" /> New tag
				</button>
			{/if}
			{#if tagsStore.items.length > 0}
				<button
					type="button"
					onclick={() => (managingTags = true)}
					class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
				>
					<Settings2 class="size-3" /> Manage
				</button>
			{/if}
			{#if selectedTagIds.length > 0}
				<button type="button" onclick={() => (selectedTagIds = [])} class="ml-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline">
					Clear tags
				</button>
			{/if}
		</div>

		<!-- Folder context line -->
		{#if folderCrumb.length > 0}
			<div class="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground" in:slide={{ duration: 200, easing: cubicOut }}>
				<FolderOpen class="size-4 text-primary" />
				{#each folderCrumb as f, i (f.id)}
					<button type="button" onclick={() => (selectedFolder = f.id)} class="transition-colors hover:text-foreground {i === folderCrumb.length - 1 ? 'font-medium text-foreground' : ''}">
						{f.name}
					</button>
					{#if i < folderCrumb.length - 1}<span class="text-muted-foreground/50">/</span>{/if}
				{/each}
				<span class="ml-1 font-mono text-[10px] tabular-nums">({visible.length})</span>
			</div>
		{/if}

		<!-- Grid -->
		{#if visible.length > 0}
			<div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each visible as rec (rec.id)}
					<div
						animate:flip={{ duration: 320, easing: cubicOut }}
						in:scale={{ start: 0.97, duration: 300, easing: cubicOut }}
						out:scale={{ start: 0.97, duration: 170, easing: cubicOut }}
					>
						<RecastCard
							recast={rec}
							folders={foldersStore.items}
							tags={tagsStore.items}
							onplay={() => (playing = rec)}
							onrename={() => (renaming = rec)}
							oncopylink={() => copyLink(rec)}
							ontogglesource={() => toggleSource(rec)}
							onmove={(folderId) => moveRecast(rec, folderId)}
							ontoggletag={(tagId) => toggleTag(rec, tagId)}
							ondelete={() => deleteRecast(rec)}
						/>
					</div>
				{/each}
			</div>
		{:else}
			<div class="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-border-low/70 py-20 text-center" in:fly={{ y: 12, duration: 360, easing: cubicOut }}>
				<span class="glass-chip grid size-12 place-items-center rounded-xl text-muted-foreground">
					<Film class="size-5" />
				</span>
				{#if !hasRecasts}
					<h3 class="mt-4 text-sm font-semibold text-foreground">No recasts yet</h3>
					<p class="mt-1 max-w-xs text-xs text-muted-foreground">Upload an MP4, or capture and export one with the Recast desktop app.</p>
					<Button size="sm" class="mt-5 gap-2" disabled={uploading} onclick={() => fileInput?.click()}>
						{#if uploading}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Upload class="size-3.5" />{/if}
						{uploading ? uploadLabel : "Upload recast"}
					</Button>
				{:else if filtersActive}
					<h3 class="mt-4 text-sm font-semibold text-foreground">No recasts match</h3>
					<p class="mt-1 max-w-xs text-xs text-muted-foreground">Nothing here matches your search, folder, and tag filters.</p>
					<Button variant="outline" size="sm" class="mt-5" onclick={clearFilters}>Clear filters</Button>
				{:else}
					<h3 class="mt-4 text-sm font-semibold text-foreground">This folder is empty</h3>
					<p class="mt-1 max-w-xs text-xs text-muted-foreground">Drag a recast onto it, or use “Move to” from a recast's menu.</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
{:else}
	<!-- Archived tab -->
	<div class="mt-6" in:fly={{ y: 12, duration: 480, delay: 80, easing: cubicOut }}>
		{#if archived.length > 0}
			<p class="mb-5 max-w-2xl text-sm text-muted-foreground">
				Recasts here lost their cloud file after 14 days without views — only the
				details remain. Re-share from the Recast desktop app to bring one back, or
				delete it for good. Each is purged automatically 16 days after archiving.
			</p>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each archived as rec (rec.id)}
					<div
						animate:flip={{ duration: 320, easing: cubicOut }}
						in:scale={{ start: 0.97, duration: 300, easing: cubicOut }}
						out:scale={{ start: 0.97, duration: 170, easing: cubicOut }}
					>
						<ArchivedCard recast={rec} ondelete={() => deleteArchived(rec)} />
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-low/70 py-20 text-center">
				<span class="glass-chip grid size-12 place-items-center rounded-xl text-muted-foreground">
					<Archive class="size-5" />
				</span>
				<h3 class="mt-4 text-sm font-semibold text-foreground">Nothing archived</h3>
				<p class="mt-1 max-w-xs text-xs text-muted-foreground">
					Unwatched recasts on the Free plan are archived after 14 days. Anything parked here will show up so you can restore or remove it.
				</p>
			</div>
		{/if}
	</div>
{/if}

{#if playing}
	<PlayerDialog
		recast={playing}
		onclose={() => (playing = null)}
		onengagement={(event) => {
			if (event.type === "view-start" && playing) {
				recastsStore.incrementViews(playing.id);
			}
		}}
	/>
{/if}

{#if renaming}
	<RenameDialog
		recast={renaming}
		onclose={() => (renaming = null)}
		onsave={(title) => renaming && doRename(renaming, title)}
	/>
{/if}

{#if managingTags}
	<TagManagerDialog onclose={() => (managingTags = false)} />
{/if}
