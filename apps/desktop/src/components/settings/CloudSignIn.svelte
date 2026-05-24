<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import {
		Check,
		Cloud,
		LoaderCircle,
		LogOut,
		ShieldAlert,
	} from "@lucide/svelte";
	import { Button } from "@recast/ui/button";
	import { toast } from "@recast/ui/sonner";
	import { onDestroy, onMount } from "svelte";

	/**
	 * "Sign in to Cloud" row. Drives the device-authorization flow via the
	 * Rust `auth_*` commands. State machine:
	 *
	 *   loading  → initial auth_status check
	 *   signed-out → button: "Sign in to Cloud" (triggers auth_start)
	 *   waiting    → browser open, code on screen, button: "Cancel"
	 *   signed-in  → shows email + Sign out button
	 *   denied     → error msg + retry button
	 *   expired    → error msg + retry button
	 */
	type AuthStatus = {
		signed_in: boolean;
		email?: string | null;
		name?: string | null;
	};
	type AuthStartResult = {
		user_code: string;
		verification_uri: string;
		expires_in: number;
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
		| { kind: "signed-in"; email: string | null; name: string | null }
		| { kind: "denied" }
		| { kind: "expired" };

	let view = $state<ViewState>({ kind: "loading" });
	let busy = $state(false);
	const unlisteners: UnlistenFn[] = [];

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
				? {
					kind: "signed-in",
					email: status.email ?? null,
					name: status.name ?? null,
				}
				: { kind: "signed-out" };
		} catch (e) {
			toast.error(`Couldn't check sign-in state: ${e}`);
			view = { kind: "signed-out" };
		}
	}

	async function startSignIn() {
		if (busy) return;
		busy = true;
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
			busy = false;
		}
	}

	async function signOut() {
		if (busy) return;
		busy = true;
		try {
			await invoke("auth_sign_out");
			toast.success("Signed out of Cloud.");
			view = { kind: "signed-out" };
		} catch (e) {
			toast.error(`Couldn't sign out: ${e}`);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		loadStatus();

		// Background-poller events from Rust. The poller fires exactly one of
		// signed-in / denied / expired / error per auth_start, so we don't
		// need to clear state machines between events.
		listen<AuthStatus>("auth:signed-in", (event) => {
			const s = event.payload;
			view = {
				kind: "signed-in",
				email: s?.email ?? null,
				name: s?.name ?? null,
			};
			toast.success("Signed in to Cloud.");
		}).then((un) => unlisteners.push(un));

		listen("auth:denied", () => {
			view = { kind: "denied" };
		}).then((un) => unlisteners.push(un));

		listen("auth:expired", () => {
			view = { kind: "expired" };
		}).then((un) => unlisteners.push(un));

		listen<string>("auth:error", (event) => {
			toast.error(`Sign-in error: ${event.payload}`);
			view = { kind: "signed-out" };
		}).then((un) => unlisteners.push(un));
	});

	onDestroy(() => {
		for (const un of unlisteners) un();
	});
</script>

<div class="px-4 py-3">
	{#if view.kind === "loading"}
		<div class="flex items-center gap-2 text-[11.5px] text-muted-foreground">
			<LoaderCircle class="size-3.5 animate-spin" />
			<span>Checking sign-in…</span>
		</div>
	{:else if view.kind === "signed-in"}
		<div class="flex items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-400"
				>
					<Check class="size-4" />
				</div>
				<div class="min-w-0">
					<div class="text-[12px] font-semibold text-foreground">
						Signed in
					</div>
					<div class="truncate text-[11px] text-muted-foreground">
						{view.email ?? "Cloud sync enabled"}
					</div>
				</div>
			</div>
			<Button
				variant="secondary"
				size="sm"
				class="h-8 gap-1.5"
				disabled={busy}
				onclick={signOut}
			>
				<LogOut class="size-3.5" />
				<span class="text-[11.5px]">Sign out</span>
			</Button>
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
					onclick={() => (view = { kind: "signed-out" })}
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
				<Cloud class="size-3.5" />
				<span class="text-[11.5px]">Try again</span>
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
				<Cloud class="size-3.5" />
				<span class="text-[11.5px]">Try again</span>
			</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<div class="text-[12px] font-semibold text-foreground">
					Not signed in
				</div>
				<div class="text-[11px] text-muted-foreground">
					Sign in to sync recordings across devices and share from the
					cloud.
				</div>
			</div>
			<Button
				size="sm"
				class="h-8 gap-1.5"
				disabled={busy}
				onclick={startSignIn}
			>
				<Cloud class="size-3.5" />
				<span class="text-[11.5px]">Sign in to Cloud</span>
			</Button>
		</div>
	{/if}
</div>
