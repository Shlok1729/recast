<script lang="ts">
	import Container from "$lib/components/Container.svelte";
	import SeoMeta from "$lib/components/SeoMeta.svelte";
	import { TOOLS } from "$lib/tools/registry";
	import { Badge } from "@recast/ui/badge";
	import * as Card from "@recast/ui/card";
	import { ShieldCheck } from "@lucide/svelte";
</script>

<SeoMeta
	title="Free Browser Video Tools"
	description="Convert, trim, compress, and extract from video for free. Everything runs in your browser. Your files are never uploaded."
	eyebrow="Tools"
/>

<div class="pt-24 pb-24 sm:pt-28">
	<Container size="wide">
		<header class="mx-auto max-w-2xl text-center">
			<Badge variant="secondary" class="gap-1.5">
				<ShieldCheck class="size-3.5" /> No upload, no account
			</Badge>
			<h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Free video tools</h1>
			<p class="mt-3 text-base text-muted-foreground">
				Quick conversions that run entirely in your browser. Your files never leave your device.
			</p>
		</header>

		<div class="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each TOOLS as tool (tool.slug)}
				<a href={`/tools/${tool.slug}`} class="group block">
					<Card.Root class="h-full transition-colors group-hover:border-primary/60">
						<Card.Header>
							<Card.Title class="text-base">{tool.title}</Card.Title>
							<Card.Description>{tool.tagline}</Card.Description>
						</Card.Header>
					</Card.Root>
				</a>
			{/each}
		</div>
	</Container>
</div>
