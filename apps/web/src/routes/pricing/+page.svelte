<script lang="ts">
	import {
		Container,
		Eyebrow,
		Footer,
		Reveal,
		Section,
		SectionHeader,
		SeoMeta,
	} from "$lib/components";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import {
		ArrowRight,
		Building2,
		Check,
		Cloud,
		Download,
		LoaderCircle,
		Mail,
		Minus,
		Sparkles,
		Users,
	} from "@lucide/svelte";
	import { cubicOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	let email = $state("");
	let joined = $state(false);
	let loading = $state(false);
	async function joinWaitlist(e: SubmitEvent) {
		e.preventDefault();
		if (!email.trim() || loading) return;
		loading = true;
		try {
			await toast.promise(
				(async () => {
					const res = await fetch("/api/waitlist", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ email, source: "pricing" }),
					});
					const data = (await res.json().catch(() => ({}))) as {
						ok?: boolean;
						error?: string;
					};
					if (!data.ok) throw new Error(data.error ?? "Couldn't join the waitlist.");
				})(),
				{
					loading: "Adding you to the waitlist…",
					success: "You're on the list — we'll email when access opens.",
					error: (err) => (err as Error)?.message ?? "Couldn't join the waitlist.",
				},
			);
			joined = true;
		} finally {
			loading = false;
		}
	}

	type Cell = boolean | string;
	type Row = { label: string; free: Cell; cloud: Cell; enterprise: Cell };
	type RowGroup = { heading: string; rows: Row[] };

	const groups: RowGroup[] = [
		{
			heading: "The app",
			rows: [
				{ label: "Record, auto-polish & edit", free: true, cloud: true, enterprise: true },
				{ label: "Hardware-accelerated export", free: true, cloud: true, enterprise: true },
				{ label: "Local .recast project files", free: true, cloud: true, enterprise: true },
				{ label: "Fully offline — no account", free: true, cloud: true, enterprise: true },
				{ label: "macOS, Windows & Linux", free: true, cloud: true, enterprise: true },
			],
		},
		{
			heading: "Sharing & analytics",
			rows: [
				{ label: "Active shareable links", free: "10", cloud: "Unlimited", enterprise: "Unlimited" },
				{ label: "Watch analytics", free: false, cloud: true, enterprise: true },
				{ label: "Custom branding & domain", free: false, cloud: true, enterprise: true },
				{ label: "Password & link expiry", free: false, cloud: true, enterprise: true },
				{ label: "Cloud library & device sync", free: false, cloud: true, enterprise: true },
				{ label: "Recast watermark on links", free: "Always on", cloud: "Removable", enterprise: "Removable" },
			],
		},
		{
			heading: "Teams",
			rows: [
				{ label: "Members per team", free: "Up to 3", cloud: "Up to 50", enterprise: "Unlimited" },
				{ label: "Teams you can own", free: "Up to 3", cloud: "Up to 10", enterprise: "Custom" },
				{ label: "Roles (owner / admin / member)", free: true, cloud: true, enterprise: true },
				{ label: "Email invitations", free: true, cloud: true, enterprise: true },
				{ label: "Per-team shared library", free: true, cloud: true, enterprise: true },
				{ label: "Audit log", free: false, cloud: false, enterprise: true },
				{ label: "SSO / SAML", free: false, cloud: false, enterprise: true },
				{ label: "Dedicated success & priority support", free: false, cloud: false, enterprise: true },
			],
		},
	];
</script>

<SeoMeta
	title="The app is free. Cloud is optional."
	description="The Recast app is free forever. Recast Cloud adds hosted demo links, watch analytics, and custom branding — join the waitlist for early access."
	eyebrow="Pricing"
/>

<main class="text-foreground">
	<Section spacing="none" class="relative overflow-hidden pt-36 pb-16 md:pt-48 md:pb-20">
		<Container>
			<div class="mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
				<Eyebrow icon={Sparkles} variant="primary">Pricing</Eyebrow>
				<h1 class="text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl md:text-7xl">
					The app is free.
					<span class="block font-medium italic text-foreground/40">So is your first team.</span>
				</h1>
				<p class="text-pretty max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
					Recording and polishing demos costs nothing — and always will. Bring along
					two teammates on a free team, or upgrade to Recast Cloud when the sharing
					layer earns its keep.
				</p>
			</div>
		</Container>
	</Section>

	<!-- Plan cards -->
	<Section spacing="tight">
		<Container>
			<div class="grid gap-4 lg:grid-cols-3">
				<!-- Free -->
				<Reveal variant="left">
					<article class="glass-card flex h-full flex-col rounded-2xl p-7 sm:p-8">
						<span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
							Free
						</span>
						<div class="mt-3 flex items-baseline gap-2">
							<span class="text-5xl font-semibold tracking-tight text-foreground">$0</span>
							<span class="text-sm text-muted-foreground">forever</span>
						</div>
						<p class="mt-4 text-sm leading-relaxed text-muted-foreground">
							The whole recorder and editor — plus a real team of three.
							Offline, no account required to record.
						</p>
						<div class="mt-5 inline-flex items-center gap-2 self-start rounded-full border border-border-low/60 bg-foreground/3 px-3 py-1 text-[11px] font-medium text-foreground/80">
							<Users class="size-3.5 text-primary" />
							Team of 3 included
						</div>
						<ul class="mt-6 space-y-3">
							{#each ["Record region, window, or full screen", "Auto cursor smoothing, layouts & zoom", "Trim, edit & hardware-accelerated export", "Up to 3 teammates per team, own up to 3 teams", "10 active shareable links (Recast watermark)", "macOS, Windows & Linux"] as point}
								<li class="flex items-start gap-2.5 text-sm text-foreground/85">
									<Check class="mt-0.5 size-4 shrink-0 text-primary" />
									{point}
								</li>
							{/each}
						</ul>
						<div class="mt-8 pt-2">
							<Button href="/download" size="lg" class="w-full gap-2">
								<Download class="size-4" />
								Download free
							</Button>
						</div>
					</article>
				</Reveal>

				<!-- Cloud / Pro -->
				<Reveal variant="up" delay={80}>
					<article class="glass-card relative flex h-full flex-col overflow-hidden rounded-2xl p-7 ring-1 ring-primary/25 sm:p-8">
						<div
							aria-hidden="true"
							class="pointer-events-none absolute -right-12 -top-12 size-56 rounded-full bg-primary/10 blur-3xl"
						></div>
						<div class="relative flex items-center justify-between">
							<span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
								Cloud
							</span>
							<span class="glass-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground/80">
								<Cloud class="size-3 text-primary" />
								Coming soon
							</span>
						</div>
						<div class="relative mt-3 flex items-baseline gap-2">
							<span class="text-5xl font-semibold tracking-tight text-foreground">Soon</span>
							<span class="text-sm text-muted-foreground">~$10 / mo </span>
						</div>
						<p class="relative mt-4 text-sm leading-relaxed text-muted-foreground">
							Everything in Free, plus the sharing layer and room for a growing team.
						</p>
						<div class="relative mt-5 inline-flex items-center gap-2 self-start rounded-full border border-primary/30 bg-primary/8 px-3 py-1 text-[11px] font-medium text-foreground/90">
							<Users class="size-3.5 text-primary" />
							Up to 50 members per team
						</div>
						<ul class="relative mt-6 space-y-3">
							{#each ["Unlimited hosted demo links, no watermark", "Watch analytics — who watched, how far", "Custom branding & your own domain", "Password protection & link expiry", "Cloud library, synced across machines", "Own up to 10 teams"] as point}
								<li class="flex items-start gap-2.5 text-sm text-foreground/85">
									<Check class="mt-0.5 size-4 shrink-0 text-primary" />
									{point}
								</li>
							{/each}
						</ul>

						<div class="relative mt-8 pt-2">
							{#if joined}
								<div
									class="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3.5"
									in:fly={{ y: 8, duration: 400, easing: cubicOut }}
								>
									<span class="grid size-7 place-items-center rounded-full bg-primary/15 text-primary">
										<Check class="size-4" />
									</span>
									<span class="text-sm font-medium text-foreground">
										You're on the early-access list.
									</span>
								</div>
							{:else}
								<form class="flex flex-col gap-2.5" onsubmit={joinWaitlist}>
									<input
										type="email"
										required
										bind:value={email}
										placeholder="founder@startup.com"
										class="w-full rounded-lg border border-border-low/70 bg-background/80 px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
									/>
									<Button type="submit" size="lg" disabled={loading} class="gap-2">
										{loading ? "Joining…" : "Join waitlist"}
										{#if loading}
											<LoaderCircle class="size-4 animate-spin" />
										{:else}
											<ArrowRight class="size-4" />
										{/if}
									</Button>
								</form>
							{/if}
						</div>
					</article>
				</Reveal>

				<!-- Enterprise -->
				<Reveal variant="right" delay={160}>
					<article class="glass-card flex h-full flex-col rounded-2xl p-7 sm:p-8">
						<div class="flex items-center justify-between">
							<span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
								Enterprise
							</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-low/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground/70">
								<Building2 class="size-3" />
								Talk to us
							</span>
						</div>
						<div class="mt-3 flex items-baseline gap-2">
							<span class="text-5xl font-semibold tracking-tight text-foreground">Custom</span>
						</div>
						<p class="mt-4 text-sm leading-relaxed text-muted-foreground">
							For larger orgs that need SSO, audit trails, and seats without
							a ceiling. Provisioned per agreement — no self-serve checkout.
						</p>
						<div class="mt-5 inline-flex items-center gap-2 self-start rounded-full border border-border-low/60 bg-foreground/3 px-3 py-1 text-[11px] font-medium text-foreground/80">
							<Users class="size-3.5 text-primary" />
							Unlimited members & teams
						</div>
						<ul class="mt-6 space-y-3">
							{#each ["Everything in Cloud", "SSO / SAML & SCIM provisioning", "Audit log & access controls", "Dedicated success manager", "Priority support & SLAs", "Volume pricing"] as point}
								<li class="flex items-start gap-2.5 text-sm text-foreground/85">
									<Check class="mt-0.5 size-4 shrink-0 text-primary" />
									{point}
								</li>
							{/each}
						</ul>
						<div class="mt-8 pt-2">
							<Button
								href="mailto:hello@recast.app?subject=Recast%20Enterprise"
								variant="secondary"
								size="lg"
								class="w-full gap-2"
							>
								<Mail class="size-4" />
								Contact sales
							</Button>
						</div>
					</article>
				</Reveal>
			</div>
		</Container>
	</Section>

	<!-- Comparison table -->
	<Section class="border-t border-border-low/60">
		<Container>
			<SectionHeader
				eyebrow="Side by side"
				title="What you get, where."
				description="The app does the work. Cloud carries it the last mile."
				align="center"
			/>

			<Reveal variant="blur" class="mt-14">
				<div class="overflow-x-auto rounded-2xl border border-border-low/50">
					<div class="min-w-160">
						<div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] border-b border-border-low/50 bg-foreground/2 text-[11px] font-semibold uppercase tracking-[0.16em]">
							<div class="px-5 py-3.5 text-muted-foreground">Feature</div>
							<div class="border-l border-border-low/50 px-5 py-3.5 text-center text-foreground">Free</div>
							<div class="border-l border-border-low/50 px-5 py-3.5 text-center text-primary">Cloud</div>
							<div class="border-l border-border-low/50 px-5 py-3.5 text-center text-foreground">Enterprise</div>
						</div>
						{#each groups as group, gi}
							<div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] border-b border-border-low/50 bg-foreground/1.5">
								<div class="col-span-4 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
									{group.heading}
								</div>
							</div>
							{#each group.rows as row, ri}
								{@const isLast = gi === groups.length - 1 && ri === group.rows.length - 1}
								<div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] {isLast ? '' : 'border-b border-border-low/40'}">
									<div class="px-5 py-3.5 text-sm text-foreground/85">{row.label}</div>
									{#each [row.free, row.cloud, row.enterprise] as cell}
										<div class="flex items-center justify-center border-l border-border-low/40 px-5 py-3.5 text-center text-sm">
											{#if cell === true}
												<Check class="size-4 text-primary" />
											{:else if cell === false}
												<Minus class="size-4 text-muted-foreground/40" />
											{:else}
												<span class="text-xs font-medium text-foreground/80">{cell}</span>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						{/each}
					</div>
				</div>
			</Reveal>

			<Reveal variant="up" class="mt-8">
				<p class="text-center text-xs text-muted-foreground">
					Cloud pricing isn't final. The free tier — a team of 3, 10 active shareable
					links — stays free forever, no card required. Need more seats?
					<a href="mailto:hello@recast.app?subject=Recast%20Enterprise" class="text-foreground underline-offset-2 hover:underline">Talk to us.</a>
				</p>
			</Reveal>
		</Container>
	</Section>

	<Footer />
</main>
