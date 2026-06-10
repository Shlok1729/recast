import { isTauriApp } from "$lib/runtime/tauri";
import {
	recastCloudDelete,
	recastCloudForgetUpload,
	recastCloudListUploads,
	recastCloudUpdateShare,
	recastCloudUpload,
	type CloudShareResult,
	type CloudUploadRecord,
} from "$lib/ipc";

/**
 * Recast Cloud share store.
 *
 * Sibling of {@link import("./gdrive.svelte").gdrive} — a `$state`-backed
 * module singleton the UI binds to. Holds sign-in state (mirrored from the
 * `auth_status` command), an `uploads` map of in-flight shares keyed by the
 * local export path, and the persisted `uploadHistory` (the manifest from
 * `commands/cloud.rs`).
 *
 * STRICTLY ADDITIVE: nothing here runs unless the user explicitly triggers a
 * share, and everything degrades to a no-op in the web build (no Tauri).
 */

export type CloudPhase = "preparing" | "uploading" | "finalizing" | "sharing";
export type CloudUploadStatus = "uploading" | "complete" | "error";

export type CloudUpload = {
	/** Local export path — also the event key from the Rust side. */
	sourcePath: string;
	fileName: string;
	phase: CloudPhase;
	status: CloudUploadStatus;
	shareUrl?: string;
	error?: string;
};

/** Minimal sign-in snapshot the share UI needs for its guard + quota. */
export type CloudAuth = {
	signedIn: boolean;
	planName?: string;
	usage?: {
		activeShares: number;
		sharesLimit: number | null;
		storageBytes: number;
	};
};

/** A workspace the user can upload into — mirrors the Rust `Workspace`. */
export type CloudWorkspace = {
	id: string;
	name: string;
	/** "owner" | "admin" | "member". */
	role: string;
	/** "free" | "pro" | "enterprise" — the org's plan. */
	plan: string;
	/** Live (non-deleted) recast count in the workspace. */
	recastsCount: number;
};

// NOTE: the Rust `auth_status` command returns a struct annotated
// `#[serde(rename_all = "camelCase")]`, so Tauri serializes every field as
// camelCase on the wire — `signedIn`, `defaultWorkspaceId`, `storageBytes`,
// etc. (NOT the Rust snake_case identifiers). An earlier version of this
// store read `s.signed_in`, which is always `undefined` over IPC — that's
// why the signed-in gate silently failed after any status refresh.
type AuthStatusShape = {
	signedIn: boolean;
	plan?: { name?: string } | null;
	usage?: {
		activeShares?: number;
		sharesLimit?: number | null;
		storageBytes?: number;
	} | null;
	workspaces?: CloudWorkspace[] | null;
	defaultWorkspaceId?: string | null;
};

/**
 * localStorage key for the user's preferred upload workspace. The value is
 * the org id; it's validated against the live membership list on every
 * status refresh and dropped if the user no longer belongs to it (e.g. they
 * left the team, or signed into a different account). This is a desktop-local
 * preference — it never mutates the server session's active org, which keeps
 * the desktop's upload target independent of what the web dashboard shows.
 */
const WORKSPACE_PREF_KEY = "recast-cloud-workspace";

function readWorkspacePref(): string | null {
	try {
		return globalThis.localStorage?.getItem(WORKSPACE_PREF_KEY) ?? null;
	} catch {
		return null;
	}
}

function writeWorkspacePref(id: string | null): void {
	try {
		if (id) globalThis.localStorage?.setItem(WORKSPACE_PREF_KEY, id);
		else globalThis.localStorage?.removeItem(WORKSPACE_PREF_KEY);
	} catch {
		// Private mode / disabled storage — selection just won't persist
		// across launches. Non-fatal; the in-memory choice still holds.
	}
}

function createCloudShareStore() {
	let signedIn = $state(false);
	let planName = $state<string | undefined>(undefined);
	let usage = $state<CloudAuth["usage"] | undefined>(undefined);

	// Workspace targeting. `workspaces` + `defaultWorkspaceId` come from the
	// server on each status refresh; `selectedWorkspaceId` is the desktop's
	// persisted preference (validated against `workspaces` below).
	let workspaces = $state<CloudWorkspace[]>([]);
	let defaultWorkspaceId = $state<string | null>(null);
	let selectedWorkspaceId = $state<string | null>(readWorkspacePref());

	const uploads = $state<Record<string, CloudUpload>>({});
	const uploadHistory = $state<Record<string, CloudUploadRecord>>({});

	// Flips true after the first `init()` completes. The share flow uses it to
	// avoid a blocking network round-trip on every click — once hydrated, the
	// cached workspace list opens the picker instantly.
	let initialized = $state(false);
	let listenersAttached = false;

	async function attachListeners() {
		if (listenersAttached) return;
		if (!(await isTauriApp())) return;
		listenersAttached = true;
		const { listen } = await import("@tauri-apps/api/event");

		await listen<{ path: string; phase: CloudPhase }>(
			"recast-cloud:progress",
			({ payload }) => {
				const existing = uploads[payload.path];
				if (!existing) return;
				uploads[payload.path] = { ...existing, phase: payload.phase, status: "uploading" };
			},
		);
		await listen<{ path: string; recastId: string; slug: string; shareUrl: string }>(
			"recast-cloud:complete",
			({ payload }) => {
				const existing = uploads[payload.path];
				if (existing) {
					uploads[payload.path] = {
						...existing,
						status: "complete",
						phase: "sharing",
						shareUrl: payload.shareUrl,
					};
				}
				uploadHistory[payload.path] = {
					recastId: payload.recastId,
					slug: payload.slug,
					shareUrl: payload.shareUrl,
					uploadedAt: Math.floor(Date.now() / 1000),
				};
			},
		);
		await listen<{ path: string; message: string }>(
			"recast-cloud:error",
			({ payload }) => {
				const existing = uploads[payload.path];
				if (!existing) return;
				uploads[payload.path] = { ...existing, status: "error", error: payload.message };
			},
		);
	}

	/** Mirror sign-in state + plan/quota + workspaces from `auth_status`. */
	async function refreshStatus() {
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const s = await invoke<AuthStatusShape>("auth_status");
			signedIn = s.signedIn;
			planName = s.plan?.name ?? undefined;
			usage = s.usage
				? {
						activeShares: s.usage.activeShares ?? 0,
						sharesLimit: s.usage.sharesLimit ?? null,
						storageBytes: s.usage.storageBytes ?? 0,
					}
				: undefined;
			applyWorkspaces(s.signedIn ? (s.workspaces ?? []) : [], s.defaultWorkspaceId ?? null);
		} catch (e) {
			console.error("[cloud] status check failed", e);
		}
	}

	/**
	 * Reconcile the workspace list + server default with the persisted local
	 * preference. Signing out (or into an account that lacks the previously
	 * chosen workspace) clears the stale selection so we never upload into a
	 * team the user no longer belongs to — the server would reject it anyway,
	 * but dropping it here keeps the UI honest.
	 */
	function applyWorkspaces(list: CloudWorkspace[], serverDefault: string | null) {
		workspaces = list;
		defaultWorkspaceId = serverDefault;
		if (selectedWorkspaceId && !list.some((w) => w.id === selectedWorkspaceId)) {
			selectedWorkspaceId = null;
			writeWorkspacePref(null);
		}
	}

	/** The workspace uploads will target: the local pick if still valid, else
	 * the server default. `null` only when the user belongs to none. */
	function resolveActiveWorkspaceId(): string | null {
		if (selectedWorkspaceId && workspaces.some((w) => w.id === selectedWorkspaceId)) {
			return selectedWorkspaceId;
		}
		return defaultWorkspaceId;
	}

	/** Persist the user's preferred upload workspace (or clear to follow the
	 * server default). No-op if `id` isn't a workspace the user belongs to. */
	function setWorkspace(id: string | null) {
		if (id && !workspaces.some((w) => w.id === id)) return;
		selectedWorkspaceId = id;
		writeWorkspacePref(id);
	}

	/** Pull the upload manifest from disk into the in-memory map. */
	async function refreshHistory() {
		if (!(await isTauriApp())) return;
		try {
			const records = await recastCloudListUploads();
			for (const key of Object.keys(uploadHistory)) delete uploadHistory[key];
			for (const [path, record] of Object.entries(records ?? {})) {
				uploadHistory[path] = record;
			}
		} catch (e) {
			console.error("[cloud] history load failed", e);
		}
	}

	/**
	 * Upload an already-exported MP4 and create a public share link. Seeds an
	 * in-flight entry so the corner card renders immediately; the Rust side
	 * drives subsequent phase updates via events. Resolves with the result or
	 * rejects (the error event already updated the card).
	 */
	async function share(
		path: string,
		title: string,
		workspaceId?: string,
	): Promise<CloudShareResult> {
		// Seed the in-flight entry SYNCHRONOUSLY (before any await) so the
		// corner "Preparing…" card renders the instant the user clicks Share —
		// otherwise the awaits below (Tauri probe + dynamic import) leave the
		// screen looking frozen for a beat.
		const fileName = path.split(/[\\/]/).pop() ?? path;
		uploads[path] = { sourcePath: path, fileName, phase: "preparing", status: "uploading" };
		if (!(await isTauriApp())) throw new Error("not running in Tauri");
		await attachListeners();
		// Explicit target wins; otherwise the resolved active workspace (local
		// pick or server default). `undefined` lets the Rust side fall back to
		// /api/desktop/profile's defaultWorkspaceId as a last resort.
		const target = workspaceId ?? resolveActiveWorkspaceId() ?? undefined;
		try {
			return await recastCloudUpload(path, title, target);
		} catch (e) {
			// The Rust side emitted `recast-cloud:error`; ensure the card
			// reflects it even if the event was missed, then re-throw.
			const existing = uploads[path];
			if (existing && existing.status !== "error") {
				uploads[path] = { ...existing, status: "error", error: String(e) };
			}
			throw e;
		}
	}

	function dismiss(path: string) {
		delete uploads[path];
	}

	/** Delete the cloud copy (blob + row + shares). Local file untouched. */
	async function deleteCloud(recastId: string, path?: string) {
		await recastCloudDelete(recastId, path);
		if (path) delete uploadHistory[path];
		else {
			for (const [p, r] of Object.entries(uploadHistory)) {
				if (r.recastId === recastId) delete uploadHistory[p];
			}
		}
	}

	/** Update an existing share's scope / password / expiry. */
	async function updateShare(
		slug: string,
		opts: {
			visibility?: "public" | "workspace" | "private";
			password?: string;
			expiresAt?: string;
		},
	) {
		await recastCloudUpdateShare(slug, opts);
	}

	/** Drop a manifest entry (no network) — e.g. the local file moved/deleted. */
	async function forget(path: string) {
		delete uploadHistory[path];
		if (!(await isTauriApp())) return;
		try {
			await recastCloudForgetUpload(path);
		} catch (e) {
			console.error("[cloud] forget failed", e);
		}
	}

	function getRecordForPath(path: string): CloudUploadRecord | undefined {
		return uploadHistory[path];
	}

	function getActiveForPath(path: string): CloudUpload | undefined {
		const u = uploads[path];
		return u && u.status === "uploading" ? u : undefined;
	}

	return {
		get signedIn() {
			return signedIn;
		},
		/** True once the first `init()` has resolved (status + workspaces loaded). */
		get initialized() {
			return initialized;
		},
		get planName() {
			return planName;
		},
		get usage() {
			return usage;
		},
		/** All workspaces the signed-in user belongs to (active-org-first). */
		get workspaces() {
			return workspaces;
		},
		/** The id uploads will target right now (local pick or server default). */
		get activeWorkspaceId() {
			return resolveActiveWorkspaceId();
		},
		/** The full workspace object for {@link activeWorkspaceId}, if known. */
		get activeWorkspace() {
			const id = resolveActiveWorkspaceId();
			return id ? (workspaces.find((w) => w.id === id) ?? null) : null;
		},
		get uploads() {
			return uploads;
		},
		get activeUploads() {
			return Object.values(uploads);
		},
		get uploadHistory() {
			return uploadHistory;
		},

		/** Attach listeners + pull status + history. Safe to call repeatedly. */
		async init() {
			await attachListeners();
			await refreshStatus();
			await refreshHistory();
			initialized = true;
		},

		refreshStatus,
		refreshHistory,
		setWorkspace,
		share,
		dismiss,
		deleteCloud,
		updateShare,
		forget,
		getRecordForPath,
		getActiveForPath,
	};
}

export const cloudShare = createCloudShareStore();
