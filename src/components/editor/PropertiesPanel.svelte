<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import { ImageIcon, MousePointer, Stamp, Volume2 } from "@lucide/svelte";
	import BackgroundPicker from "./BackgroundPicker.svelte";
	import CursorPanel from "./CursorPanel.svelte";
	import SliderControl from "./SliderControl.svelte";

	interface Props {
		store: EditorStore;
	}

	let { store }: Props = $props();

	type PanelTab = "background" | "cursor" | "audio" | "watermark";

	let activeTab = $state<PanelTab>("background");

	const tabs: { id: PanelTab; icon: typeof ImageIcon; label: string }[] = [
		{ id: "background", icon: ImageIcon, label: "Background" },
		{ id: "cursor", icon: MousePointer, label: "Cursor" },
		{ id: "audio", icon: Volume2, label: "Audio" },
		{ id: "watermark", icon: Stamp, label: "Watermark" },
	];

	// Audio state
	let volume = $state(100);
	let fadeIn = $state(0);
	let fadeOut = $state(0);

	// Watermark state
	let watermarkEnabled = $state(false);
	let watermarkOpacity = $state(50);
	let watermarkPosition = $state<
		"top-left" | "top-right" | "bottom-left" | "bottom-right"
	>("bottom-right");
</script>

<div
	class="flex h-full flex-col border-l border-border bg-card/50 backdrop-blur-sm"
>
	<!-- Tab bar -->
	<div class="flex shrink-0 border-b border-border">
		{#each tabs as tab}
			{@const Icon = tab.icon}
			<button
				onclick={() => (activeTab = tab.id)}
				class="group relative flex flex-1 items-center justify-center py-3 transition-colors duration-200
					{activeTab === tab.id
					? 'text-foreground'
					: 'text-muted-foreground hover:text-foreground/70'}"
				title={tab.label}
			>
				<Icon
					size={18}
					strokeWidth={activeTab === tab.id ? 2.2 : 1.8}
				/>

				<!-- Active indicator -->
				{#if activeTab === tab.id}
					<div
						class="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-foreground transition-all duration-300 animate-in fade-in zoom-in-x-0"
					></div>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Panel Content -->
	<div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
		{#if activeTab === "background"}
			<BackgroundPicker {store} />
		{:else if activeTab === "cursor"}
			<CursorPanel {store} />
		{:else if activeTab === "audio"}
			<div class="flex flex-col gap-5 animate-in fade-in duration-300">
				<section>
					<h4
						class="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
					>
						<Volume2 size={14} class="text-muted-foreground" />
						Audio Settings
					</h4>

					<div class="flex flex-col gap-4">
						<SliderControl
							label="Volume"
							bind:value={volume}
							min={0}
							max={100}
							step={5}
							unit="%"
						>
							{#snippet icon()}
								<Volume2 size={12} />
							{/snippet}
						</SliderControl>

						<SliderControl
							label="Fade In"
							bind:value={fadeIn}
							min={0}
							max={5}
							step={0.5}
							unit="s"
						/>
						<SliderControl
							label="Fade Out"
							bind:value={fadeOut}
							min={0}
							max={5}
							step={0.5}
							unit="s"
						/>
					</div>
				</section>

				<section>
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-muted-foreground"
							>Mute audio</span
						>
						<button
							aria-label="Mute audio"
							onclick={() => {
								volume = volume === 0 ? 100 : 0;
							}}
							class="relative h-5 w-9 rounded-full transition-colors duration-200
								{volume === 0 ? 'bg-destructive' : 'bg-muted'}"
						>
							<div
								class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
									{volume === 0 ? 'translate-x-4' : 'translate-x-0.5'}"
							></div>
						</button>
					</div>
				</section>
			</div>
		{:else if activeTab === "watermark"}
			<div class="flex flex-col gap-5 animate-in fade-in duration-300">
				<section>
					<div class="mb-3 flex items-center justify-between">
						<h4
							class="flex items-center gap-2 text-sm font-semibold text-foreground"
						>
							<Stamp size={14} class="text-muted-foreground" />
							Watermark
						</h4>
						<button
							aria-label="Toggle watermark"
							onclick={() =>
								(watermarkEnabled = !watermarkEnabled)}
							class="relative h-5 w-9 rounded-full transition-colors duration-200
								{watermarkEnabled ? 'bg-primary' : 'bg-muted'}"
						>
							<div
								class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200
									{watermarkEnabled ? 'translate-x-4' : 'translate-x-0.5'}"
							></div>
						</button>
					</div>

					{#if watermarkEnabled}
						<div
							class="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-200"
						>
							<!-- Upload Area -->
							<div
								class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/50 py-6 text-center transition-colors hover:border-border cursor-pointer"
							>
								<Stamp
									size={20}
									class="mb-1.5 text-muted-foreground/50"
								/>
								<p class="text-[11px] text-muted-foreground">
									Upload logo or image
								</p>
							</div>

							<!-- Position -->
							<div>
								<span
									class="mb-2 block text-xs font-medium text-muted-foreground"
									>Position</span
								>
								<div class="grid grid-cols-2 gap-1.5">
									{#each [{ pos: "top-left", label: "↖ Top Left" }, { pos: "top-right", label: "↗ Top Right" }, { pos: "bottom-left", label: "↙ Bottom Left" }, { pos: "bottom-right", label: "↘ Bottom Right" }] as item}
										<button
											onclick={() =>
												(watermarkPosition =
													item.pos as typeof watermarkPosition)}
											class="rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all duration-200
												{watermarkPosition === item.pos
												? 'bg-foreground text-background'
												: 'bg-muted text-muted-foreground hover:text-foreground'}"
										>
											{item.label}
										</button>
									{/each}
								</div>
							</div>

							<SliderControl
								label="Opacity"
								bind:value={watermarkOpacity}
								min={10}
								max={100}
								step={5}
								unit="%"
							/>
						</div>
					{/if}
				</section>
			</div>
		{/if}
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: var(--muted-foreground);
		opacity: 0.2;
		border-radius: 100px;
	}
</style>
