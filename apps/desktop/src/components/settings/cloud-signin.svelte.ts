/**
 * The Recast Cloud sign-in state machine, extracted from CloudSignIn.svelte so
 * the component is markup + wiring. Drives the device-authorization flow via the
 * Rust `auth_*` commands and the background-poller events. States:
 *
 *   loading    → initial auth_status check
 *   signed-out → "Sign in to Recast Cloud" (auth_start)
 *   waiting    → browser open, code on screen, "Cancel"
 *   signed-in  → profile card (avatar, plan, usage, manage)
 *   denied / expired → error + retry
 *
 * Lifecycle: the component calls `start()` in onMount and `dispose()` in
 * onDestroy. Reactive state (`view`, `busy`, `inFlight`) is exposed via getters;
 * read them through a local `$derived` in the component so discriminated-union
 * narrowing on `view` keeps working in the markup.
 *
 * This is a rune module (uses `$state`) and imports Tauri/stores, so it isn't
 * unit-tested; the pure formatters live in `cloud-signin.logic.ts` (tested).
 */

import {
	authCancel,
	authSignOut,
	authStart,
	authStatus,
	type AuthPlan,
	type AuthStatus,
	type AuthUsage,
} from "$lib/ipc";
import { cloudShare } from "$lib/stores/cloudShare.svelte";
import { toast } from "@recast/ui/sonner";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SignedInProfile = {
	email: string | null;
	name: string | null;
	image: string | null;
	memberSince: string | null;
	plan: AuthPlan | null;
	usage: AuthUsage | null;
};

export type ViewState =
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

export class CloudAuth {
	#view = $state<ViewState>({ kind: "loading" });
	// Which action is mid-flight, so the right button shows its own spinner +
	// active-verb label. `null` = idle.
	#inFlight = $state<null | "sign-in" | "sign-out">(null);
	#unlisteners: UnlistenFn[] = [];
	#destroyed = false;

	get view(): ViewState {
		return this.#view;
	}
	get inFlight(): null | "sign-in" | "sign-out" {
		return this.#inFlight;
	}
	get busy(): boolean {
		return this.#inFlight !== null;
	}

	async loadStatus(): Promise<void> {
		try {
			const status = await authStatus();
			this.#view = status.signedIn
				? { kind: "signed-in", ...toProfile(status) }
				: { kind: "signed-out" };
			// Keep the shared store (which the share flow reads for workspace
			// targeting) in sync with what we just fetched.
			void cloudShare.refreshStatus();
		} catch (e) {
			toast.error(`Couldn't check sign-in state: ${e}`);
			this.#view = { kind: "signed-out" };
		}
	}

	async startSignIn(): Promise<void> {
		if (this.busy) return;
		this.#inFlight = "sign-in";
		try {
			const result = await authStart();
			this.#view = {
				kind: "waiting",
				userCode: result.user_code,
				verificationUri: result.verification_uri,
				expiresAt: Date.now() + result.expires_in * 1000,
			};
		} catch (e) {
			toast.error(`Couldn't start sign-in: ${e}`);
		} finally {
			this.#inFlight = null;
		}
	}

	async signOut(): Promise<void> {
		if (this.busy) return;
		this.#inFlight = "sign-out";
		try {
			await authSignOut();
			toast.success("Signed out of Recast Cloud.");
			this.#view = { kind: "signed-out" };
			// Drops the cached workspace list + persisted selection.
			void cloudShare.refreshStatus();
		} catch (e) {
			toast.error(`Couldn't sign out: ${e}`);
		} finally {
			this.#inFlight = null;
		}
	}

	/**
	 * Cancel an in-flight sign-in: tell the Rust poller to stop (so an approval
	 * in the abandoned browser tab can't silently sign the user in) and reset
	 * the view immediately — the abort is best-effort and instant Rust-side.
	 */
	async cancelSignIn(): Promise<void> {
		this.#view = { kind: "signed-out" };
		try {
			await authCancel();
		} catch (e) {
			// Idempotent on the Rust side; surfacing it would only confuse since
			// the UI already reset.
			console.warn("auth_cancel failed (non-fatal):", e);
		}
	}

	/** Begin: initial status check + subscribe to the Rust poller events. */
	start(): void {
		this.loadStatus();

		// Each handler ignores the firing if the view is no longer "waiting" —
		// defense in depth on top of `auth_cancel`, in case a poll response
		// landed between the user clicking Cancel and the abort taking effect.
		void (async () => {
			const handles = await Promise.all([
				listen<AuthStatus>("auth:signed-in", (event) => {
					if (this.#view.kind !== "waiting") return;
					const s = event.payload;
					// The Rust poller already fetched the full profile, so the payload
					// carries plan + usage — no refetch needed.
					this.#view = {
						kind: "signed-in",
						...toProfile(s ?? ({} as AuthStatus)),
					};
					void cloudShare.refreshStatus();
					toast.success("Signed in to Recast Cloud.");
				}),
				listen("auth:denied", () => {
					if (this.#view.kind !== "waiting") return;
					this.#view = { kind: "denied" };
				}),
				listen("auth:expired", () => {
					if (this.#view.kind !== "waiting") return;
					this.#view = { kind: "expired" };
				}),
				listen<string>("auth:error", (event) => {
					if (this.#view.kind !== "waiting") return;
					toast.error(`Sign-in error: ${event.payload}`);
					this.#view = { kind: "signed-out" };
				}),
				// Self-host endpoint changed (Settings → Cloud → Server endpoint):
				// the Rust side dropped the old token, so re-check against the new
				// endpoint, flipping the card back to signed-out without a reload.
				listen("cloud:endpoint-changed", () => {
					if (this.#view.kind === "waiting") void this.cancelSignIn();
					this.#view = { kind: "loading" };
					this.loadStatus();
				}),
			]);
			// If dispose() ran while the listens were resolving, releasing here
			// avoids leaking the handles forever.
			if (this.#destroyed) {
				for (const un of handles) un();
				return;
			}
			this.#unlisteners = handles;
		})();
	}

	/** Tear down the event subscriptions. */
	dispose(): void {
		this.#destroyed = true;
		for (const un of this.#unlisteners) un();
		this.#unlisteners = [];
	}
}
