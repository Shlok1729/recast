<script lang="ts">
	import {
	  ArrowUpRight,
	  Cloud,
	  Crown,
	  LoaderCircle,
	  LogOut,
	  ShieldAlert,
	  Sparkles,
	  Video,
	} from "@lucide/svelte";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import { cn } from "@recast/ui/utils";
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { onDestroy, onMount } from "svelte";

	/**
	 * "Sign in to Recast Cloud" row. Recast Cloud is the Loom-style sharing
	 * layer (instant share links, viewer analytics, password protection,
	 * branding) on top of the free local app — the app itself never needs
	 * an account. Drives the device-authorization flow via the Rust
	 * `auth_*` commands. State machine:
	 *
	 *   loading    → initial auth_status check
	 *   signed-out → button: "Sign in to Recast Cloud" (triggers auth_start)
	 *   waiting    → browser open, code on screen, button: "Cancel"
	 *   signed-in  → rich profile card (avatar, plan, usage, manage)
	 *   denied     → error msg + retry button
	 *   expired    → error msg + retry button
	 */
	type AuthPlan = {
		id: string;
		name: string;
		status: string;
		currentPeriodEnd: string | null;
		cancelAtPeriodEnd: boolean;
	};
	type AuthUsage = {
		recordings: number;
		storageBytes: number;
		activeShares: number;
		sharesLimit: number | null;
	};
	type AuthStatus = {
		signed_in: boolean;
		email?: string | null;
		name?: string | null;
		image?: string | null;
		memberSince?: string | null;
		plan?: AuthPlan | null;
		usage?: AuthUsage | null;
	};
	type AuthStartResult = {
		user_code: string;
		verification_uri: string;
		expires_in: number;
	};

	type SignedInProfile = {
		email: string | null;
		name: string | null;
		image: string | null;
		memberSince: string | null;
		plan: AuthPlan | null;
		usage: AuthUsage | null;
	};

	type ViewState =
		| { kind: "loading" }
		| { kind: "signed-out" }
		| {
			kind: "waiting";
			userCode: string;
			verificationUri: string;
			expiresAt: number;
		}
		| ({ kind: "signed-in" } & SignedInProfile)
		| { kind: "denied" }
		| { kind: "expired" };

	function toProfile(s: AuthStatus): SignedInProfile {
		return {
			email: s.email ?? null,
			name: s.name ?? null,
			image: s.image ?? null,
			memberSince: s.memberSince ?? null,
			plan: s.plan ?? null,
			usage: s.usage ?? null,
		};
	}

	/** "K", "KK", "?" — feeds the avatar fallback. */
	function initials(name: string | null, email: string | null): string {
		const source = (name ?? email ?? "").trim();
		if (!source) return "?";
		const parts = source.split(/\s+/).filter(Boolean);
		if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
		return source.slice(0, 2).toUpperCase();
	}

	/** "1.2 GB", "640 MB", "0 B". */
	function formatBytes(bytes: number): string {
		if (!bytes || bytes < 0) return "0 B";
		const units = ["B", "KB", "MB", "GB", "TB"];
		let i = 0;
		let value = bytes;
		while (value >= 1024 && i < units.length - 1) {
			value /= 1024;
			i++;
		}
		return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
	}

	/** "May 2026". */
	function formatMemberSince(iso: string | null): string | null {
		if (!iso) return null;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
	}

	const dashboardUrl = "https://recast.nexonauts.com/dashboard/settings/profile";

	async function openDashboard() {
		try {
			await openUrl(dashboardUrl);
		} catch (e) {
			toast.error(`Couldn't open browser: ${e}`);
		}
	}

	let view = $state<ViewState>({ kind: "loading" });
	// Tracks which action is mid-flight so the right button can show its own
	// spinner + active-verb label ("Signing in…", "Signing out…"). A plain
	// boolean wouldn't tell us which of the two buttons triggered the
	// disable. `null` = idle.
	let inFlight = $state<null | "sign-in" | "sign-out">(null);
	const busy = $derived(inFlight !== null);
	let unlisteners: UnlistenFn[] = [];
	let destroyed = false;

	function formatUserCode(code: string): string {
		const clean = code.replace(/-/g, "").toUpperCase();
		if (clean.length <= 4) return clean;
		const half = Math.floor(clean.length / 2);
		return `${clean.slice(0, half)}-${clean.slice(half)}`;
	}

	async function loadStatus() {
		try {
			const status = await invoke<AuthStatus>("auth_status");
			view = status.signed_in
				? { kind: "signed-in", ...toProfile(status) }
				: { kind: "signed-out" };
		} catch (e) {
			toast.error(`Couldn't check sign-in state: ${e}`);
			view = { kind: "signed-out" };
		}
	}

	/** Refetch profile (plan/usage) without leaving the signed-in card. */
	async function refreshProfile() {
		try {
			const status = await invoke<AuthStatus>("auth_status");
			if (status.signed_in && view.kind === "signed-in") {
				view = { kind: "signed-in", ...toProfile(status) };
			}
		} catch {
			// Silent — keep stale data on a transient refresh failure.
		}
	}

	async function startSignIn() {
		if (busy) return;
		inFlight = "sign-in";
		try {
			const result = await invoke<AuthStartResult>("auth_start");
			view = {
				kind: "waiting",
				userCode: result.user_code,
				verificationUri: result.verification_uri,
				expiresAt: Date.now() + result.expires_in * 1000,
			};
		} catch (e) {
			toast.error(`Couldn't start sign-in: ${e}`);
		} finally {
			inFlight = null;
		}
	}

	async function signOut() {
		if (busy) return;
		inFlight = "sign-out";
		try {
			await invoke("auth_sign_out");
			toast.success("Signed out of Recast Cloud.");
			view = { kind: "signed-out" };
		} catch (e) {
			toast.error(`Couldn't sign out: ${e}`);
		} finally {
			inFlight = null;
		}
	}

	/**
	 * Cancel an in-flight sign-in. Two responsibilities:
	 *
	 *   1. Tell the Rust poller to stop (`auth_cancel`). Without this the
	 *      background poller keeps hitting /device/token until the code
	 *      expires — and if the user approves in the (now-abandoned)
	 *      browser tab, the next poll would silently sign them in despite
	 *      the UI showing "signed-out".
	 *   2. Reset the local view immediately. Don't await `auth_cancel` for
	 *      the UI transition — the abort is best-effort and instant on the
	 *      Rust side anyway.
	 */
	async function cancelSignIn() {
		view = { kind: "signed-out" };
		try {
			await invoke("auth_cancel");
		} catch (e) {
			// Cancel is idempotent on the Rust side; surfacing this would
			// only confuse the user since the UI already reset.
			console.warn("auth_cancel failed (non-fatal):", e);
		}
	}

	onMount(() => {
		loadStatus();

		// Background-poller events from Rust. Each event handler ignores the
		// firing if the view is no longer "waiting" — this is defense in
		// depth on top of `auth_cancel`'s abort, in case a poll response
		// landed BETWEEN the user clicking Cancel and the abort taking effect.
		// Without this gate, a stale "signed-in" event could yank a
		// signed-out UI into signed-in state without further user action.
		(async () => {
			const handles = await Promise.all([
				listen<AuthStatus>("auth:signed-in", (event) => {
					if (view.kind !== "waiting") return;
					const s = event.payload;
					// The Rust poller already fetched the full profile (it hits
					// /api/desktop/profile after /device/token returns), so the
					// payload carries plan + usage — no refetch needed here.
					view = { kind: "signed-in", ...toProfile(s ?? ({} as AuthStatus)) };
					toast.success("Signed in to Recast Cloud.");
				}),
				listen("auth:denied", () => {
					if (view.kind !== "waiting") return;
					view = { kind: "denied" };
				}),
				listen("auth:expired", () => {
					if (view.kind !== "waiting") return;
					view = { kind: "expired" };
				}),
				listen<string>("auth:error", (event) => {
					if (view.kind !== "waiting") return;
					toast.error(`Sign-in error: ${event.payload}`);
					view = { kind: "signed-out" };
				}),
			]);
			// If onDestroy fired while the listens were resolving, we'd leak
			// these handles forever — call them immediately instead.
			if (destroyed) {
				for (const un of handles) un();
				return;
			}
			unlisteners = handles;
		})();
	});

	onDestroy(() => {
		destroyed = true;
		for (const un of unlisteners) un();
		unlisteners = [];
	});
</script>

<div class="px-4 py-3">
	{#if view.kind === "loading"}
		<div class="flex items-center gap-2 text-[11.5px] text-muted-foreground">
			<LoaderCircle class="size-3.5 animate-spin" />
			<span>Checking sign-in…</span>
		</div>
	{:else if view.kind === "signed-in"}
		{@const planId = view.plan?.id ?? "free"}
		{@const isPaid = planId !== "free"}
		{@const memberSinceLabel = formatMemberSince(view.memberSince)}
		{@const shareCap = view.usage?.sharesLimit}
		{@const sharesActive = view.usage?.activeShares ?? 0}
		<div class="flex flex-col">
			<!-- Identity row: avatar + name/email + plan badge -->
			<div class="flex items-center gap-3 px-4 py-4">
				<div
					class="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[13px] font-semibold text-foreground ring-1 ring-inset ring-border/50"
				>
					{#if view.image}
						<img
							src={view.image}
							alt={view.name ?? view.email ?? "Profile"}
							referrerpolicy="no-referrer"
							class="size-full object-cover"
						/>
					{:else}
						{initials(view.name, view.email)}
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<div class="truncate text-[13px] font-semibold text-foreground">
							{view.name ?? view.email ?? "Signed in"}
						</div>
						<span
							class={cn(
								"inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest",
								isPaid
									? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
									: "bg-muted text-muted-foreground ring-1 ring-inset ring-border/50",
							)}
						>
							{#if isPaid}
								<Crown class="size-2.5" />
							{/if}
							{view.plan?.name ?? "Free"}
						</span>
					</div>
					{#if view.name && view.email}
						<div class="truncate text-[11px] text-muted-foreground">
							{view.email}
						</div>
					{/if}
					{#if memberSinceLabel}
						<div class="mt-0.5 text-[10.5px] text-muted-foreground/70">
							Member since {memberSinceLabel}
						</div>
					{/if}
				</div>
				<Button
					variant="ghost"
					size="sm"
					class="h-8 shrink-0 gap-1.5"
					disabled={busy}
					onclick={signOut}
				>
					{#if inFlight === "sign-out"}
						<LoaderCircle class="size-3.5 animate-spin" />
						<span class="text-[11.5px]">Signing out…</span>
					{:else}
						<LogOut class="size-3.5" />
						<span class="text-[11.5px]">Sign out</span>
					{/if}
				</Button>
			</div>

			<!-- Usage stats — only render if we got profile data back. The
				 fallback get-session path leaves `usage` null; rather than
				 stub zeros (which read as "you have nothing") we hide the
				 row entirely. -->
			{#if view.usage}
				<div class="grid grid-cols-3 divide-x divide-border/40 border-t border-border/40">
					<div class="flex flex-col gap-0.5 px-4 py-3">
						<div class="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
							<Video class="size-2.5" />
							Recordings
						</div>
						<div class="text-[14px] font-semibold text-foreground">
							{view.usage.recordings}
						</div>
					</div>
					<div class="flex flex-col gap-0.5 px-4 py-3">
						<div class="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
							Storage
						</div>
						<div class="text-[14px] font-semibold text-foreground">
							{formatBytes(view.usage.storageBytes)}
						</div>
					</div>
					<div class="flex flex-col gap-0.5 px-4 py-3">
						<div class="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
							Active shares
						</div>
						<div class="text-[14px] font-semibold text-foreground">
							{sharesActive}{#if shareCap != null}
								<span class="text-[11px] font-medium text-muted-foreground"
									>/{shareCap}</span
								>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- Actions: upgrade CTA (free only) + manage account in browser -->
			<div class="flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-3">
				{#if !isPaid}
					<Button
						size="sm"
						class="h-8 gap-1.5"
						onclick={() => openUrl("https://recast.li/pricing")}
					>
						<Sparkles class="size-3.5" />
						<span class="text-[11.5px]">Upgrade to Pro</span>
					</Button>
				{/if}
				<Button
					variant="outline"
					size="sm"
					class="h-8 gap-1.5"
					onclick={openDashboard}
				>
					<span class="text-[11.5px]">Manage account</span>
					<ArrowUpRight class="size-3 text-muted-foreground" />
				</Button>
				{#if view.plan?.cancelAtPeriodEnd && view.plan?.currentPeriodEnd}
					<span class="ml-auto text-[10.5px] text-amber-600 dark:text-amber-400">
						Ends {new Date(view.plan.currentPeriodEnd).toLocaleDateString()}
					</span>
				{/if}
			</div>
		</div>
	{:else if view.kind === "waiting"}
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<div class="text-[12px] font-semibold text-foreground">
						Waiting for browser approval
					</div>
					<div class="text-[11px] text-muted-foreground">
						Approve the sign-in in the browser tab we opened.
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					class="h-8 gap-1.5 text-muted-foreground"
					onclick={cancelSignIn}
				>
					<span class="text-[11.5px]">Cancel</span>
				</Button>
			</div>
			<div
				class="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 px-3 py-2"
			>
				<span
					class="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground"
				>
					Code
				</span>
				<span
					class="font-mono text-[13px] font-semibold tracking-[0.25em] text-foreground"
				>
					{formatUserCode(view.userCode)}
				</span>
			</div>
		</div>
	{:else if view.kind === "denied"}
		<div class="flex items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30"
				>
					<ShieldAlert class="size-4" />
				</div>
				<div class="min-w-0">
					<div class="text-[12px] font-semibold text-foreground">
						Sign-in denied
					</div>
					<div class="text-[11px] text-muted-foreground">
						Authorization was rejected in the browser.
					</div>
				</div>
			</div>
			<Button
				variant="secondary"
				size="sm"
				class="h-8 gap-1.5"
				disabled={busy}
				onclick={startSignIn}
			>
				{#if inFlight === "sign-in"}
					<LoaderCircle class="size-3.5 animate-spin" />
					<span class="text-[11.5px]">Signing in…</span>
				{:else}
					<Cloud class="size-3.5" />
					<span class="text-[11.5px]">Try again</span>
				{/if}
			</Button>
		</div>
	{:else if view.kind === "expired"}
		<div class="flex items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400"
				>
					<ShieldAlert class="size-4" />
				</div>
				<div class="min-w-0">
					<div class="text-[12px] font-semibold text-foreground">
						Code expired
					</div>
					<div class="text-[11px] text-muted-foreground">
						Take less than 30 minutes next time.
					</div>
				</div>
			</div>
			<Button
				variant="secondary"
				size="sm"
				class="h-8 gap-1.5"
				disabled={busy}
				onclick={startSignIn}
			>
				{#if inFlight === "sign-in"}
					<LoaderCircle class="size-3.5 animate-spin" />
					<span class="text-[11.5px]">Signing in…</span>
				{:else}
					<Cloud class="size-3.5" />
					<span class="text-[11.5px]">Try again</span>
				{/if}
			</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<div class="text-[12px] font-semibold text-foreground">
					Connect Recast Cloud
				</div>
				<div class="text-[11px] text-muted-foreground">
					Send a Loom-style share link with viewer analytics, comments, and
					password protection. The app itself never needs an account —
					Cloud is opt-in.
				</div>
			</div>
			<Button
				size="sm"
				class="h-8 gap-1.5"
				disabled={busy}
				onclick={startSignIn}
			>
				{#if inFlight === "sign-in"}
					<LoaderCircle class="size-3.5 animate-spin" />
					<span class="text-[11.5px]">Signing in…</span>
				{:else}
					<Cloud class="size-3.5" />
					<span class="text-[11.5px]">Sign in to Recast Cloud</span>
				{/if}
			</Button>
		</div>
	{/if}
</div>
