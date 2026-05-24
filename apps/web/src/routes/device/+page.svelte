<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { authClient } from "$lib/auth/client";
	import Logo from "$lib/logo.svelte";
	import {
		AlertTriangle,
		ArrowRight,
		Check,
		KeyRound,
		LoaderCircle,
		Monitor,
		X,
	} from "@lucide/svelte";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import { cubicOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	let { data } = $props();

	// Manual code-entry input — only used if the desktop didn't pre-fill via
	// verification_uri_complete (i.e. the user typed the URL or wrote the
	// code down). Initialized once from data.userCode — if the user navigates
	// (the only way `data` changes here), the page remounts anyway.
	let manualCode = $state("");
	$effect(() => {
		manualCode = data.userCode ?? "";
	});
	let manualSubmitting = $state(false);

	let approving = $state(false);
	let denying = $state(false);
	const busy = $derived(approving || denying);

	// RFC 8628 user codes are random ASCII; the convention is to show them
	// split in half with a dash for readability (the plugin tolerates either
	// form on the wire — POST /device/approve strips dashes before lookup).
	function formatUserCode(code: string | null | undefined): string {
		if (!code) return "";
		const clean = code.replace(/-/g, "").toUpperCase();
		if (clean.length <= 4) return clean;
		const half = Math.floor(clean.length / 2);
		return `${clean.slice(0, half)}-${clean.slice(half)}`;
	}

	async function submitManualCode() {
		const code = manualCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
		if (!code) return;
		manualSubmitting = true;
		try {
			// Navigating to /device?user_code=... re-runs the +page.server.ts
			// load, which redirects unauthenticated users to /login first and
			// only then calls the plugin's GET /device (session-binding step).
			await goto(`/device?user_code=${encodeURIComponent(code)}`, {
				invalidateAll: true,
			});
		} finally {
			manualSubmitting = false;
		}
	}

	async function approve() {
		if (busy || !data.userCode) return;
		approving = true;
		const toastId = toast.loading("Approving device…");
		try {
			const { error } = await authClient.device.approve({
				userCode: data.userCode,
			});
			if (error)
				throw new Error(error.error_description ?? "Couldn't approve the device.");
			toast.success("Device signed in. Return to the desktop app.", {
				id: toastId,
			});
			// The desktop poller picks this up within `interval` seconds. No
			// auto-redirect: the user came here from the desktop and likely
			// wants to switch back manually.
			await invalidateAll();
		} catch (err) {
			toast.error((err as Error)?.message ?? "Couldn't approve the device.", {
				id: toastId,
			});
			approving = false;
		}
	}

	async function deny() {
		if (busy || !data.userCode) return;
		denying = true;
		try {
			await toast.promise(
				(async () => {
					const { error } = await authClient.device.deny({
						userCode: data.userCode!,
					});
					if (error)
						throw new Error(error.error_description ?? "Couldn't deny the request.");
				})(),
				{
					loading: "Denying…",
					success: "Device request denied.",
					error: (err) => (err as Error)?.message ?? "Couldn't deny the request.",
				},
			);
			await invalidateAll();
		} finally {
			denying = false;
		}
	}

	// Status returned by GET /device — "pending" means waiting on user
	// approval (the normal case after a fresh device.code call); "approved"
	// and "denied" mean someone already acted on this code (most likely the
	// same user in another tab).
	const deviceStatus = $derived(
		(data.device as { status?: string } | null)?.status ?? null,
	);
	const alreadyHandled = $derived(
		deviceStatus === "approved" || deviceStatus === "denied",
	);
</script>

<svelte:head>
	<title>Authorize device — Recast</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="relative grid min-h-screen place-items-center px-6 py-16 text-foreground">
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 -z-10"
		style="background: radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--color-primary) 9%, transparent), transparent 72%);"
	></div>
	<div
		aria-hidden="true"
		class="bg-grid bg-grid-fade pointer-events-none absolute inset-0 -z-10 opacity-30"
	></div>

	<div class="w-full max-w-md" in:fly={{ y: 16, duration: 520, easing: cubicOut }}>
		<div class="flex flex-col items-center text-center">
			<a href="/" class="group/logo flex items-center gap-2.5" aria-label="Recast — home">
				<span
					class="grid size-9 place-items-center rounded-xl bg-foreground p-1 text-background shadow-craft-sm transition-transform group-hover/logo:rotate-[-4deg]"
				>
					<Logo size="22" color="transparent" fill="currentColor" />
				</span>
				<span class="text-lg font-semibold tracking-tight text-foreground">Recast</span>
			</a>

			<span
				class="glass-chip mt-7 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"
			>
				<Monitor class="size-3" />
				Authorize device
			</span>

			<h1 class="text-balance mt-5 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
				{#if !data.userCode}
					Enter your device code
				{:else if data.error}
					Code not recognized
				{:else if alreadyHandled}
					This code has been used
				{:else}
					Sign in to Recast Desktop?
				{/if}
			</h1>
			<p class="text-pretty mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
				{#if !data.userCode}
					Type the code shown in your Recast Desktop app.
				{:else if data.error}
					{data.error}
				{:else if alreadyHandled}
					Start a new sign-in from the desktop app if you need another session.
				{:else}
					Approving links this account to the desktop so it can sync your recordings.
				{/if}
			</p>
		</div>

		<div class="glass-card mt-8 rounded-2xl p-6 shadow-craft-lg sm:p-7">
			{#if !data.userCode}
				<!-- Manual code entry. We don't require sign-in to render this —
				     the user might be writing the code down before they sign in.
				     The /device?user_code=... navigation triggers +page.server.ts
				     which redirects unauthenticated users through /login. -->
				<form
					onsubmit={(e) => {
						e.preventDefault();
						submitManualCode();
					}}
					class="flex flex-col gap-3"
				>
					<label
						for="device-code-input"
						class="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground"
					>
						Device code
					</label>
					<div class="relative">
						<KeyRound
							class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							id="device-code-input"
							type="text"
							bind:value={manualCode}
							placeholder="ABCD-1234"
							autocomplete="off"
							spellcheck="false"
							maxlength="12"
							class="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 font-mono text-base uppercase tracking-[0.2em] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
						/>
					</div>
					<Button
						type="submit"
						disabled={manualSubmitting || manualCode.trim().length === 0}
						class="group/cta w-full gap-2"
					>
						{#if manualSubmitting}
							<LoaderCircle class="size-4 animate-spin" />
						{/if}
						{manualSubmitting ? "Checking…" : "Continue"}
						{#if !manualSubmitting}
							<ArrowRight class="size-4 transition-transform group-hover/cta:translate-x-0.5" />
						{/if}
					</Button>
				</form>
			{:else if data.error}
				<div class="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
					<AlertTriangle class="size-5 text-amber-500" />
					<span>{data.error}</span>
					<Button href="/device" variant="outline" size="sm" class="mt-2">
						Enter a different code
					</Button>
				</div>
			{:else if alreadyHandled}
				<div class="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
					{#if deviceStatus === "approved"}
						<Check class="size-5 text-emerald-500" />
						<span>Already approved — return to the desktop app.</span>
					{:else}
						<X class="size-5 text-destructive" />
						<span>Already denied.</span>
					{/if}
				</div>
			{:else}
				<!-- Authenticated + bound. Show approval card with the code for
				     visual confirmation against the desktop screen. -->
				<div class="flex flex-col gap-4">
					<div
						class="rounded-xl border border-border/60 bg-background/50 p-4 text-center"
					>
						<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							Code
						</div>
						<div
							class="mt-1.5 font-mono text-2xl font-semibold tracking-[0.3em] text-foreground"
						>
							{formatUserCode(data.userCode)}
						</div>
					</div>
					<p class="text-center text-xs text-muted-foreground">
						Make sure this matches the code shown in your Recast Desktop app
						before approving.
					</p>
					<div class="flex flex-col gap-2.5">
						<Button onclick={approve} disabled={busy} class="group/cta w-full gap-2">
							{#if approving}
								<LoaderCircle class="size-4 animate-spin" />
							{:else}
								<Check class="size-4" />
							{/if}
							{approving ? "Approving…" : "Approve & sign in desktop"}
						</Button>
						<Button
							variant="ghost"
							onclick={deny}
							disabled={busy}
							class="w-full gap-2 text-muted-foreground"
						>
							{#if denying}
								<LoaderCircle class="size-4 animate-spin" />
							{:else}
								<X class="size-4" />
							{/if}
							{denying ? "Denying…" : "Deny"}
						</Button>
					</div>
					<p class="text-center text-[11px] text-muted-foreground">
						Signed in as <span class="font-medium text-foreground">{data.viewer?.email ?? ""}</span>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
