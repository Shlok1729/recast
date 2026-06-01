<script lang="ts">
	import {
		formatBytes,
		formatCount,
		formatDuration,
		formatRelative,
	} from "$lib/dashboard/format";
	import type { Folder, Tag } from "$lib/dashboard/library.svelte";
	import type { Recast } from "$lib/dashboard/store.svelte";
	import { Chip } from "@recast/ui/chip";
	import * as DropdownMenu from "@recast/ui/dropdown-menu";
	import {
		Check,
		Clock,
		Cloud,
		CloudUpload,
		Film,
		FolderInput,
		HardDrive,
		Inbox,
		Link2,
		MonitorPlay,
		MoreHorizontal,
		Pencil,
		Play,
		Tag as TagIcon,
		Trash2,
	} from "@lucide/svelte";

	let {
		recast,
		folders,
		tags,
		onplay,
		onrename,
		oncopylink,
		ontogglesource,
		onmove,
		ontoggletag,
		ondelete,
	}: {
		recast: Recast;
		folders: Folder[];
		tags: Tag[];
		onplay: () => void;
		onrename: () => void;
		oncopylink: () => void;
		ontogglesource: () => void;
		onmove: (folderId: string | null) => void;
		ontoggletag: (tagId: string) => void;
		ondelete: () => void;
	} = $props();

	let posterFailed = $state(false);
	const showPoster = $derived(!!recast.posterUrl && !posterFailed);

	const assignedTags = $derived(
		recast.tags
			.map((id) => tags.find((t) => t.id === id))
			.filter((t): t is Tag => Boolean(t)),
	);
	const assignedSet = $derived(new Set(recast.tags));

	// Folders sorted by their materialized path so nesting reads top-down in
	// the "Move to" submenu; depth drives indentation.
	const sortedFolders = $derived([...folders].sort((a, b) => a.path.localeCompare(b.path)));
	function depthOf(path: string): number {
		return Math.max(0, (path.match(/\//g)?.length ?? 1) - 2);
	}

	function onDragStart(e: DragEvent) {
		e.dataTransfer?.setData("text/recast-id", recast.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
	}
</script>

<article
	draggable="true"
	ondragstart={onDragStart}
	class="glass-card group/card relative flex h-full cursor-grab flex-col overflow-hidden rounded-xl transition-shadow duration-300 hover:shadow-craft-lg active:cursor-grabbing"
>
	<!-- Thumbnail (fixed height — robust across grid breakpoints) -->
	<button
		type="button"
		onclick={onplay}
		aria-label="Play {recast.title}"
		class="relative block h-44 w-full shrink-0 overflow-hidden bg-foreground/5"
	>
		{#if showPoster}
			<img
				src={recast.posterUrl}
				alt=""
				loading="lazy"
				onerror={() => (posterFailed = true)}
				class="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-[1.04]"
			/>
		{:else}
			<div
				aria-hidden="true"
				class="absolute inset-0 opacity-60"
				style="background-image: radial-gradient(circle, color-mix(in srgb, var(--color-foreground) 8%, transparent) 1px, transparent 1px); background-size: 16px 16px;"
			></div>
			<div
				aria-hidden="true"
				class="pointer-events-none absolute -bottom-10 left-1/2 size-44 -translate-x-1/2 rounded-full opacity-70"
				style="background: radial-gradient(closest-side, color-mix(in srgb, var(--color-primary) 22%, transparent), transparent 75%);"
			></div>
			<div class="absolute inset-0 grid place-items-center">
				<span class="grid size-16 place-items-center rounded-xl border border-border-low/60 bg-background/55 shadow-craft-sm backdrop-blur-sm">
					<Film class="size-7 text-foreground/70 drop-shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]" />
				</span>
			</div>
		{/if}

		<span aria-hidden="true" class="pointer-events-none absolute left-2 top-2 z-10 size-2.5 border-l border-t border-foreground/35"></span>
		<span aria-hidden="true" class="pointer-events-none absolute right-2 top-2 z-10 size-2.5 border-r border-t border-foreground/35"></span>
		<span aria-hidden="true" class="pointer-events-none absolute bottom-2 left-2 z-10 size-2.5 border-b border-l border-foreground/35"></span>
		<span aria-hidden="true" class="pointer-events-none absolute bottom-2 right-2 z-10 size-2.5 border-b border-r border-foreground/35"></span>

		<span class="absolute inset-0 grid place-items-center bg-background/35 opacity-0 backdrop-blur-[1px] transition-opacity duration-300 group-hover/card:opacity-100">
			<span class="grid size-12 place-items-center rounded-full bg-primary text-background shadow-craft-floating transition-transform duration-200 group-active/card:scale-95">
				<Play class="size-5 translate-x-0.5 fill-current" />
			</span>
		</span>

		<span class="absolute bottom-2.5 right-2.5 z-20 flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border-low/50 backdrop-blur-sm">
			<Clock class="size-3" />
			{formatDuration(recast.durationSec)}
		</span>

		<span
			class="absolute left-2.5 top-2.5 z-20 flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset backdrop-blur-sm
				{recast.source === 'cloud'
				? 'bg-primary/90 text-background ring-primary/40'
				: 'bg-background/85 text-muted-foreground ring-border-low/50'}"
		>
			{#if recast.source === "cloud"}
				<Cloud class="size-3" />{recast.provider}
			{:else}
				<MonitorPlay class="size-3" />Local
			{/if}
		</span>
	</button>

	<!-- Meta -->
	<div class="flex flex-1 flex-col p-4">
		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-sm font-semibold text-foreground" title={recast.title}>
					{recast.title}
				</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					{formatRelative(recast.createdAt)} · {formatBytes(recast.sizeBytes)}{#if recast.source === "cloud"} · {formatCount(recast.views)} views{/if}
				</p>
			</div>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					aria-label="Recast options"
				>
					<MoreHorizontal class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" sideOffset={6} class="w-52">
					<DropdownMenu.Item onclick={onplay}>
						<Play class="size-4 text-muted-foreground" />
						Play
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={onrename}>
						<Pencil class="size-4 text-muted-foreground" />
						Rename
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={oncopylink}>
						<Link2 class="size-4 text-muted-foreground" />
						Copy link
					</DropdownMenu.Item>

					<!-- Move to folder -->
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							<FolderInput class="size-4 text-muted-foreground" />
							Move to
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="max-h-72 w-56 overflow-y-auto">
							<DropdownMenu.Item onclick={() => onmove(null)}>
								<Inbox class="size-4 text-muted-foreground" />
								<span class="flex-1">No folder</span>
								{#if !recast.folderId}<Check class="size-3.5 text-primary" />{/if}
							</DropdownMenu.Item>
							{#if sortedFolders.length > 0}
								<DropdownMenu.Separator />
								{#each sortedFolders as f (f.id)}
									<DropdownMenu.Item onclick={() => onmove(f.id)}>
										<span style="width: {depthOf(f.path) * 10}px" class="shrink-0"></span>
										{#if f.color}
											<span class="size-2.5 shrink-0 rounded-[3px]" style="background:{f.color}"></span>
										{/if}
										<span class="flex-1 truncate">{f.name}</span>
										{#if recast.folderId === f.id}<Check class="size-3.5 text-primary" />{/if}
									</DropdownMenu.Item>
								{/each}
							{/if}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>

					<!-- Tags -->
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							<TagIcon class="size-4 text-muted-foreground" />
							Tags
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="max-h-72 w-56 overflow-y-auto">
							{#if tags.length === 0}
								<div class="px-2 py-2 text-xs text-muted-foreground">
									No tags yet — create one from the filter bar.
								</div>
							{:else}
								{#each tags as t (t.id)}
									<DropdownMenu.CheckboxItem
										checked={assignedSet.has(t.id)}
										onclick={() => ontoggletag(t.id)}
										closeOnSelect={false}
									>
										{#if t.color}
											<span class="size-2.5 shrink-0 rounded-full" style="background:{t.color}"></span>
										{/if}
										{t.name}
									</DropdownMenu.CheckboxItem>
								{/each}
							{/if}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>

					<DropdownMenu.Item onclick={ontogglesource}>
						{#if recast.source === "cloud"}
							<HardDrive class="size-4 text-muted-foreground" />
							Move to local
						{:else}
							<CloudUpload class="size-4 text-muted-foreground" />
							Upload to cloud
						{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item
						onclick={ondelete}
						class="text-destructive/90 data-highlighted:text-destructive"
					>
						<Trash2 class="size-4" />
						Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>

		<!-- Assigned tags -->
		{#if assignedTags.length > 0}
			<div class="mt-2.5 flex flex-wrap gap-1.5">
				{#each assignedTags as t (t.id)}
					<Chip label={t.name} color={t.color} class="py-0.5 text-[10px]" />
				{/each}
			</div>
		{/if}
	</div>
</article>
