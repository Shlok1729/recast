<script lang="ts">
	import * as api from "$lib/dashboard/api";
	import FolderRail, { type FolderSelection } from "$lib/dashboard/components/FolderRail.svelte";
	import PlayerDialog from "$lib/dashboard/components/PlayerDialog.svelte";
	import RecastCard from "$lib/dashboard/components/RecastCard.svelte";
	import RenameDialog from "$lib/dashboard/components/RenameDialog.svelte";
	import StatCard from "$lib/dashboard/components/StatCard.svelte";
	import { focusOnMount } from "$lib/dashboard/focus";
	import { formatBytes } from "$lib/dashboard/format";
	import { foldersStore, tagsStore } from "$lib/dashboard/library.svelte";
	import {
	  recastsStore,
	  settingsStore,
	  type Recast,
	  type RecordingSource,
	} from "$lib/dashboard/store.svelte";
	import { Chip } from "@recast/ui/chip";
	import { Cloud, Film, FolderOpen, HardDrive, LoaderCircle, Plus, Search, Upload, Video, X } from "@lucide/svelte";
	import { Button } from "@recast/ui/button";
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

	type SortKey = "recent" | "oldest" | "name" | "largest";

	let query = $state("");
	let activeFilter = $state<RecordingSource | "all">("all");
	let sortKey = $state<string>("recent");
	let selectedFolder = $state<FolderSelection>("all");
	let selectedTagIds = $state<string[]>([]);

	let playing = $state<Recast | null>(null);
	let renaming = $state<Recast | null>(null);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Inline tag creation in the filter bar.
	let creatingTag = $state(false);
	let newTagName = $state("");

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

	function readDuration(url: string): Promise<number> {
		return new Promise((resolve) => {
			const v = document.createElement("video");
			v.preload = "metadata";
			v.onloadedmetadata = () => resolve(v.duration || 0);
			v.onerror = () => resolve(0);
			v.src = url;
		});
	}

	async function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			await toast.promise(
				(async () => {
					const url = URL.createObjectURL(file);
					const durationSec = await readDuration(url);
					const destination = settingsStore.value.preferences.defaultDestination;
					recastsStore.add({
						id: crypto.randomUUID(),
						title: file.name.replace(/\.[^.]+$/, "") || "Untitled recast",
						durationSec,
						createdAt: Date.now(),
						sizeBytes: file.size,
						source: destination,
						provider: destination === "cloud" ? "Cloudinary" : null,
						views: 0,
						folderId: selectedFolder !== "all" && selectedFolder !== "root" ? selectedFolder : null,
						tags: [],
						videoUrl: url,
						posterUrl: "",
					});
				})(),
				{
					loading: `Adding “${file.name}”…`,
					success: `“${file.name}” added to your library.`,
					error: (err) => (err as Error)?.message ?? "Couldn't add that file.",
				},
			);
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
			await navigator.clipboard.writeText(`https://recast.nexonauts.com/v/${rec.id}`);
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

<input bind:this={fileInput} type="file" accept="video/*" class="hidden" onchange={onFilePicked} />

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
		{uploading ? "Adding…" : "Upload recast"}
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

<!-- Library: folder rail + content -->
<div class="mt-8 flex flex-col gap-6 lg:flex-row" in:fly={{ y: 12, duration: 480, delay: 240, easing: cubicOut }}>
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
					<p class="mt-1 max-w-xs text-xs text-muted-foreground">Upload a video, or capture one with the Recast desktop app.</p>
					<Button size="sm" class="mt-5 gap-2" disabled={uploading} onclick={() => fileInput?.click()}>
						{#if uploading}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Upload class="size-3.5" />{/if}
						{uploading ? "Adding…" : "Upload recast"}
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
