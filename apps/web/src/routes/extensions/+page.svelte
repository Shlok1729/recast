<script lang="ts">
	import {
		Container,
		Footer,
		Reveal,
		Section,
		SectionHeader,
		SeoMeta,
	} from "$lib/components";
	import { Button } from "@recast/ui/button";
	import {
		ArrowRight,
		Blend,
		Blocks,
		Check,
		Download,
		Github,
		Hash,
		Image as ImageIcon,
		Lock,
		MousePointer2,
		Palette,
		ShieldCheck,
		Spline,
		Sparkles,
		Waves,
	} from "@lucide/svelte";

	// The six contribution kinds a pack can add. These map 1:1 to the editor's
	// pickers, so the page reads as "this shows up where you already work".
	const kinds = [
		{ icon: MousePointer2, title: "Cursors", description: "Pointer styles with rest + click states and precise hotspots, in the cursor picker." },
		{ icon: ImageIcon, title: "Backgrounds", description: "Wallpapers that drop straight into the canvas background picker." },
		{ icon: Blend, title: "Gradients", description: "Curated gradient sets, rendered live in both preview and export." },
		{ icon: Palette, title: "Colors", description: "Solid-color swatches for the canvas, ready to click." },
		{ icon: Spline, title: "Easing presets", description: "Named motion curves for zoom and cursor animation." },
		{ icon: Waves, title: "Smoothing presets", description: "Cursor-smoothing recipes — strength plus click-snap — shared as packs." },
	];

	const steps = [
		{ icon: Blocks, title: "Browse or paste", description: "Open the Extensions tab in the editor and browse the registry — or paste a pack URL to install one directly." },
		{ icon: Download, title: "Install in a click", description: "The pack downloads, every asset is hash-verified, and it installs to your machine. No account, no network round-trip to us." },
		{ icon: Sparkles, title: "Use it everywhere", description: "Its cursors, backgrounds, gradients and presets appear in the pickers you already use. Toggle or remove it any time." },
	];

	const trust = [
		{ icon: Lock, title: "No code runs", description: "A pack is a manifest plus static files. Nothing executes — there's no sandbox to escape because there's nothing to sandbox." },
		{ icon: Hash, title: "Hash-pinned over HTTPS", description: "Every asset is SHA-256 verified on download. A tampered or swapped file fails the install outright." },
		{ icon: ShieldCheck, title: "Zero permissions", description: "Asset packs can't request capabilities. A pack can never reach further than the app itself already can." },
		{ icon: Check, title: "Open & checked", description: "The registry is public on GitHub, and every submission is verified by CI — schema, hashes, and safe filenames — before it can ship." },
	];
</script>

<SeoMeta
	title="Extensions — make Recast yours"
	description="Install community asset packs right in the Recast editor: cursors, backgrounds, gradients, and motion presets. Declarative, hash-verified, zero permissions. Free, offline, and open."
	eyebrow="Extensions"
/>

<main class="text-foreground">
	<!-- Hero -->
	<Section spacing="loose">
		<Container>
			<SectionHeader
				eyebrow="Extensions"
				title="Make Recast yours."
				description="Cursors, backgrounds, gradients, and motion presets — installed right in the editor, from an open community registry. Every pack is just a manifest and static files: no code, hash-verified, zero permissions. The app stays free, offline, and yours."
				align="center"
			/>
			<Reveal variant="up" delay={120} class="mt-10 flex flex-wrap items-center justify-center gap-3">
				<Button href="/download" class="gap-2">
					<Download class="size-4" />
					Get the app
				</Button>
				<Button
					href="https://github.com/kanakkholwal/recast/tree/main/extensions"
					variant="ghost"
					class="gap-2"
				>
					<Github class="size-4" />
					Browse the registry
				</Button>
			</Reveal>
		</Container>
	</Section>

	<!-- What a pack can add -->
	<Section id="kinds" class="border-t border-border-low/60 bg-foreground/1.5 dark:bg-foreground/2">
		<Container>
			<SectionHeader
				eyebrow="What a pack adds"
				title="It shows up where you already work."
				description="A pack contributes to the same pickers you use every day — nothing new to learn. Mix any of these in a single pack."
				align="center"
			/>
			<div class="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border-low/40 bg-border-low/30 sm:grid-cols-2 lg:grid-cols-3">
				{#each kinds as kind, i}
					{@const Icon = kind.icon}
					<Reveal variant="morph" delay={i * 70} class="h-full">
						<div class="flex h-full flex-col gap-3 bg-background/50 p-6 backdrop-blur-md">
							<Icon class="size-5 text-primary" />
							<div>
								<div class="text-sm font-semibold text-foreground">{kind.title}</div>
								<div class="mt-1.5 text-xs leading-relaxed text-muted-foreground">{kind.description}</div>
							</div>
						</div>
					</Reveal>
				{/each}
			</div>
		</Container>
	</Section>

	<!-- How it works -->
	<Section id="how" class="border-t border-border-low/60">
		<Container>
			<SectionHeader
				eyebrow="How it works"
				title="Three clicks, not a config file."
				align="center"
			/>
			<div class="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
				{#each steps as step, i}
					{@const Icon = step.icon}
					<Reveal variant="up" delay={i * 80} class="h-full">
						<div class="flex h-full flex-col gap-4 rounded-2xl border border-border-low/40 bg-background/50 p-7">
							<div class="flex items-center gap-3">
								<span class="glass-chip grid size-9 shrink-0 place-items-center rounded-lg text-primary">
									<Icon class="size-4" />
								</span>
								<span class="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
									Step {i + 1}
								</span>
							</div>
							<div>
								<div class="text-base font-semibold text-foreground">{step.title}</div>
								<div class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.description}</div>
							</div>
						</div>
					</Reveal>
				{/each}
			</div>
		</Container>
	</Section>

	<!-- Safe by design -->
	<Section id="safe" class="border-t border-border-low/60 bg-foreground/1.5 dark:bg-foreground/2">
		<Container>
			<SectionHeader
				eyebrow="Safe by design"
				title="Installable, without the install-anything risk."
				description="Plugins usually mean running someone else's code. Recast packs don't — they only carry assets, so the whole class of plugin-supply-chain attacks simply doesn't apply."
				align="center"
			/>
			<div class="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border-low/40 bg-border-low/30 sm:grid-cols-2 lg:grid-cols-4">
				{#each trust as t, i}
					{@const Icon = t.icon}
					<Reveal variant="blur" delay={i * 70} class="h-full">
						<div class="flex h-full flex-col gap-3 bg-background/50 p-6 backdrop-blur-md">
							<Icon class="size-5 text-primary" />
							<div>
								<div class="text-sm font-semibold text-foreground">{t.title}</div>
								<div class="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.description}</div>
							</div>
						</div>
					</Reveal>
				{/each}
			</div>
		</Container>
	</Section>

	<!-- Build & share -->
	<Section id="build" class="border-t border-border-low/60">
		<Container>
			<div class="grid items-center gap-14 lg:grid-cols-12 lg:gap-20">
				<div class="lg:col-span-6">
					<SectionHeader
						eyebrow="Build & share"
						title="Make a pack in an afternoon."
						description="Drop your SVGs or images in a folder, write a small manifest, and open a pull request. CI verifies the schema, hashes, and filenames; once it's merged, it's in the gallery for everyone — with your name on it."
					/>
					<ul class="mt-10 space-y-3.5">
						{#each [
							{ icon: ImageIcon, title: "Add your assets", description: "Cursors as SVG, backgrounds as PNG/JPG/WebP — bare files in your pack's assets/ folder." },
							{ icon: Blocks, title: "Write the manifest", description: "A few lines of JSON declaring what each file contributes. No URLs or hashes to hand-write." },
							{ icon: Check, title: "Verify & open a PR", description: "Run pnpm verify:extensions, push, and the Verify Extensions workflow does the rest." },
						] as f, i}
							{@const Icon = f.icon}
							<Reveal as="li" variant="left" delay={i * 70} class="flex items-start gap-3.5">
								<span class="glass-chip mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-primary">
									<Icon class="size-4" />
								</span>
								<span>
									<span class="text-sm font-semibold text-foreground">{f.title}</span>
									<span class="block text-sm leading-relaxed text-muted-foreground">{f.description}</span>
								</span>
							</Reveal>
						{/each}
					</ul>
					<div class="mt-9 flex flex-wrap gap-3">
						<Button
							href="https://github.com/kanakkholwal/recast/tree/main/extensions"
							class="gap-2"
						>
							<Github class="size-4" />
							Read the contributor guide
						</Button>
						<Button href="/download" variant="ghost" class="gap-2">
							Get the app
							<ArrowRight class="size-4" />
						</Button>
					</div>
				</div>

				<div class="lg:col-span-6">
					<Reveal variant="morph">
						<div class="glass-card relative overflow-hidden rounded-2xl p-1.5 shadow-craft-lg">
							<div class="flex h-9 items-center gap-2 rounded-t-xl border-b border-border-low/40 bg-white/5 px-4">
								<Blocks class="size-3.5 text-primary" />
								<span class="text-[11px] font-medium text-muted-foreground">extension.json</span>
							</div>
							<pre class="overflow-x-auto rounded-b-xl bg-background/60 p-5 text-[11.5px] leading-relaxed text-muted-foreground"><code>{`{
  "id": "my-cursors",
  "name": "My Cursors",
  "version": "1.0.0",
  "kind": "asset-pack",
  "permissions": [],
  "contributes": {
    "cursors": [
      { "id": "ring", "label": "Ring",
        "rest": "ring",
        "hotspot": { "x": 32, "y": 32 } }
    ]
  },
  "assets": [
    { "id": "ring", "file": "assets/ring.svg" }
  ]
}`}</code></pre>
						</div>
					</Reveal>
				</div>
			</div>
		</Container>
	</Section>

	<Footer />
</main>
