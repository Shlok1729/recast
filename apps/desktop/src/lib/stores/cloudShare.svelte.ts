import { isTauriApp } from "$lib/runtime/tauri";
import {
	authStatus,
	recastCloudDelete,
	recastCloudForgetUpload,
	recastCloudListUploads,
	recastCloudUpdateShare,
	recastCloudUpload,
	type CloudShareResult,
	type CloudUploadRecord,
	type CloudWorkspace,
	type Transcript,
} from "$lib/ipc";

export type { CloudWorkspace };

/**
 * Recast Cloud share store — sibling of {@link import("./gdrive.svelte").gdrive}.
 * A `$state`-backed singleton holding sign-in state (from `auth_status`), an
 * `uploads` map of in-flight shares keyed by export path, and the persisted
 * `uploadHistory` manifest from `commands/cloud.rs`. Nothing runs unless the
 * user triggers a share; everything no-ops in the web build.
 */

export type CloudPhase = "preparing" | "uploading" | "finalizing" | "sharing";
export type CloudUploadStatus = "uploading" | "complete" | "error";

export type CloudUpload = {
	/** Local export path — also the event key from the Rust side. */
	sourcePath: string;
	fileName: string;
	phase: CloudPhase;
	status: CloudUploadStatus;
	/** Byte-level progress for the upload PUT (0/0 until the first event). */
	bytesSent: number;
	totalBytes: number;
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


/**
 * Preferred upload workspace (org id). Validated against live membership on
 * each status refresh and dropped if the user no longer belongs. Desktop-local
 * — never mutates the server session's active org, so the desktop's upload
 * target stays independent of the web dashboard.
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
		// Private mode / disabled storage — selection won't persist across
		// launches, but the in-memory choice still holds.
	}
}

function createCloudShareStore() {
	let signedIn = $state(false);
	let planName = $state<string | undefined>(undefined);
	let usage = $state<CloudAuth["usage"] | undefined>(undefined);

	// `workspaces` + `defaultWorkspaceId` come from the server each refresh;
	// `selectedWorkspaceId` is the desktop's persisted, validated preference.
	let workspaces = $state<CloudWorkspace[]>([]);
	let defaultWorkspaceId = $state<string | null>(null);
	let selectedWorkspaceId = $state<string | null>(readWorkspacePref());

	const uploads = $state<Record<string, CloudUpload>>({});
	const uploadHistory = $state<Record<string, CloudUploadRecord>>({});

	// True after the first `init()`. Lets the share flow open the picker from
	// the cached workspace list instead of a blocking round-trip per click.
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
		// Byte-level progress during the upload PUT — drives the determinate bar.
		await listen<{ path: string; bytesSent: number; totalBytes: number }>(
			"recast-cloud:upload-progress",
			({ payload }) => {
				const existing = uploads[payload.path];
				if (!existing) return;
				uploads[payload.path] = {
					...existing,
					bytesSent: payload.bytesSent,
					totalBytes: payload.totalBytes,
					phase: "uploading",
					status: "uploading",
				};
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
			const s = await authStatus();
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
	 * Reconcile the server workspace list + default with the local preference,
	 * dropping a stale selection (e.g. signed out, or into an account lacking
	 * that workspace) so the picker never points at a team the user left.
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
		captionsTranscript?: Transcript | null,
	): Promise<CloudShareResult> {
		// Seed SYNCHRONOUSLY (before any await) so the "Preparing…" card renders
		// the instant Share is clicked — the awaits below would otherwise leave
		// the screen looking frozen for a beat.
		const fileName = path.split(/[\\/]/).pop() ?? path;
		uploads[path] = {
			sourcePath: path,
			fileName,
			phase: "preparing",
			status: "uploading",
			bytesSent: 0,
			totalBytes: 0,
		};
		if (!(await isTauriApp())) throw new Error("not running in Tauri");
		await attachListeners();
		// Explicit target wins, else the resolved active workspace; `undefined`
		// lets Rust fall back to the server profile's defaultWorkspaceId.
		const target = workspaceId ?? resolveActiveWorkspaceId() ?? undefined;
		try {
			return await recastCloudUpload(path, title, target, captionsTranscript);
		} catch (e) {
			// Rust emitted `recast-cloud:error`; ensure the card reflects it even
			// if the event was missed, then re-throw.
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
