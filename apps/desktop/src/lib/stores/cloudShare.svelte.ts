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

type AuthStatusShape = {
	signed_in: boolean;
	plan?: { name?: string } | null;
	usage?: {
		active_shares?: number;
		shares_limit?: number | null;
		storage_bytes?: number;
	} | null;
};

function createCloudShareStore() {
	let signedIn = $state(false);
	let planName = $state<string | undefined>(undefined);
	let usage = $state<CloudAuth["usage"] | undefined>(undefined);

	const uploads = $state<Record<string, CloudUpload>>({});
	const uploadHistory = $state<Record<string, CloudUploadRecord>>({});

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

	/** Mirror sign-in state + plan/quota from the Rust `auth_status` command. */
	async function refreshStatus() {
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const s = await invoke<AuthStatusShape>("auth_status");
			signedIn = s.signed_in;
			planName = s.plan?.name ?? undefined;
			usage = s.usage
				? {
						activeShares: s.usage.active_shares ?? 0,
						sharesLimit: s.usage.shares_limit ?? null,
						storageBytes: s.usage.storage_bytes ?? 0,
					}
				: undefined;
		} catch (e) {
			console.error("[cloud] status check failed", e);
		}
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
	async function share(path: string, title: string): Promise<CloudShareResult> {
		if (!(await isTauriApp())) throw new Error("not running in Tauri");
		await attachListeners();
		const fileName = path.split(/[\\/]/).pop() ?? path;
		uploads[path] = { sourcePath: path, fileName, phase: "preparing", status: "uploading" };
		try {
			return await recastCloudUpload(path, title);
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
		get planName() {
			return planName;
		},
		get usage() {
			return usage;
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
		},

		refreshStatus,
		refreshHistory,
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
