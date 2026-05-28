import { isTauriApp } from "$lib/runtime/tauri";

/**
 * Google Drive store.
 *
 * Mirrors the shape of {@link import("./updater.svelte").updater} — a small
 * `$state`-backed module singleton that the UI binds to directly. Holds the
 * current connection state, the connected account's email (best-effort
 * populated from Google's userinfo endpoint), and an `uploads` map keyed by
 * `uploadId`. The store is a thin shell over Tauri commands and events; the
 * actual OAuth + Drive REST plumbing lives in `commands/gdrive.rs`.
 *
 * Lazy imports keep this module safe to load in the web build, where the
 * Tauri runtime doesn't exist.
 */

export type GdriveUploadStatus = "uploading" | "complete" | "error" | "cancelled";

export type GdriveUpload = {
	uploadId: string;
	/**
	 * The local source path being uploaded. Lets list views look up
	 * "is this row currently uploading?" without scanning by filename.
	 */
	sourcePath: string;
	fileName: string;
	bytesSent: number;
	totalBytes: number;
	status: GdriveUploadStatus;
	webViewLink?: string;
	error?: string;
};

type GdriveUploadResult = {
	fileId: string;
	name: string;
	webViewLink?: string;
};

/**
 * Persistent record of a previously-uploaded export, keyed by local file
 * path. Mirrors the Rust `UploadRecord` struct from `commands/gdrive.rs`.
 * Sourced from a JSON file on disk — no database.
 */
export type UploadRecord = {
	fileId: string;
	name: string;
	webViewLink?: string;
	/** Unix seconds. */
	uploadedAt: number;
};

function createGdriveStore() {
	let connected = $state(false);
	let email = $state<string | null>(null);
	let connecting = $state(false);
	const uploads = $state<Record<string, GdriveUpload>>({});
	/**
	 * History of completed uploads, indexed by local file path. Hydrated
	 * from disk on `init()` via `gdrive_list_uploads`, and incrementally
	 * updated when `gdrive:upload-complete` fires. Drives the exports
	 * list dropdown ("Upload to Drive" vs. "Copy link / Re-upload").
	 */
	const uploadHistory = $state<Record<string, UploadRecord>>({});

	let listenersAttached = false;

	async function attachListeners() {
		if (listenersAttached) return;
		if (!(await isTauriApp())) return;
		listenersAttached = true;
		const { listen } = await import("@tauri-apps/api/event");

		await listen<{ connected: boolean; email?: string | null }>(
			"gdrive:connected",
			({ payload }) => {
				connected = payload.connected;
				email = payload.email ?? null;
				connecting = false;
			},
		);
		await listen<{
			uploadId: string;
			bytesSent: number;
			totalBytes: number;
		}>("gdrive:progress", ({ payload }) => {
			const existing = uploads[payload.uploadId];
			if (!existing) return;
			uploads[payload.uploadId] = {
				...existing,
				bytesSent: payload.bytesSent,
				totalBytes: payload.totalBytes,
			};
		});
		await listen<
			{ uploadId: string; sourcePath: string } & GdriveUploadResult
		>("gdrive:upload-complete", ({ payload }) => {
			const existing = uploads[payload.uploadId];
			if (existing) {
				uploads[payload.uploadId] = {
					...existing,
					status: "complete",
					bytesSent: existing.totalBytes || existing.bytesSent,
					webViewLink: payload.webViewLink,
				};
			}
			// Merge into the persistent history so the exports list flips
			// its action from "Upload" to "Copy link / Re-upload" without
			// a roundtrip to disk. Re-uploads overwrite the prior entry.
			uploadHistory[payload.sourcePath] = {
				fileId: payload.fileId,
				name: payload.name,
				webViewLink: payload.webViewLink,
				uploadedAt: Math.floor(Date.now() / 1000),
			};
		});
		await listen<{ uploadId: string; message: string; cancelled: boolean }>(
			"gdrive:upload-error",
			({ payload }) => {
				const existing = uploads[payload.uploadId];
				if (!existing) return;
				uploads[payload.uploadId] = {
					...existing,
					status: payload.cancelled ? "cancelled" : "error",
					error: payload.cancelled ? undefined : payload.message,
				};
			},
		);
	}

	/** Read current connection state from the Rust side. Best-effort. */
	async function refreshStatus() {
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const status = await invoke<{ connected: boolean; email?: string }>(
				"gdrive_status",
			);
			connected = status.connected;
			email = status.email ?? null;
		} catch (e) {
			console.error("[gdrive] status check failed", e);
		}
	}

	/** Pull the upload history from disk into the in-memory map. */
	async function refreshHistory() {
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const records = await invoke<Record<string, UploadRecord>>(
				"gdrive_list_uploads",
			);
			// Wipe then refill so deletions made elsewhere propagate.
			for (const key of Object.keys(uploadHistory)) {
				delete uploadHistory[key];
			}
			for (const [path, record] of Object.entries(records ?? {})) {
				uploadHistory[path] = record;
			}
		} catch (e) {
			console.error("[gdrive] history load failed", e);
		}
	}

	/**
	 * Start the OAuth flow. The Rust side opens the browser, awaits the
	 * loopback callback, exchanges the code, persists the refresh token,
	 * and emits `gdrive:connected` on success. We just need to flip
	 * `connecting` while it's in flight.
	 */
	async function connect() {
		if (!(await isTauriApp())) return;
		await attachListeners();
		connecting = true;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("gdrive_connect");
			// Success path: the `gdrive:connected` listener flips state.
		} catch (e) {
			connecting = false;
			console.error("[gdrive] connect failed", e);
			throw e;
		}
	}

	async function disconnect() {
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("gdrive_disconnect");
		} catch (e) {
			console.error("[gdrive] disconnect failed", e);
		}
		connected = false;
		email = null;
	}

	/**
	 * Kick off an upload. Returns the synthetic upload id so callers can
	 * pair UI state (toast cards, progress bars) to the same key the
	 * store and Rust side use. The Promise resolves with the result or
	 * rejects on failure — but the corner-card UI usually relies on the
	 * `uploads` map updating via events, not on awaiting this Promise.
	 */
	async function upload(path: string): Promise<GdriveUploadResult> {
		if (!(await isTauriApp())) throw new Error("not running in Tauri");
		await attachListeners();
		const fileName = path.split(/[\\/]/).pop() ?? path;
		const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		uploads[uploadId] = {
			uploadId,
			sourcePath: path,
			fileName,
			bytesSent: 0,
			totalBytes: 0,
			status: "uploading",
		};
		const { invoke } = await import("@tauri-apps/api/core");
		try {
			return await invoke<GdriveUploadResult>("gdrive_upload", {
				path,
				uploadId,
			});
		} catch (e) {
			// The Rust side already emitted `gdrive:upload-error` for the
			// corner-card UI; re-throw for any caller that awaits the
			// Promise (e.g. for inline error toasts).
			throw e;
		}
	}

	async function cancelUpload(uploadId: string) {
		if (!(await isTauriApp())) return;
		const { invoke } = await import("@tauri-apps/api/core");
		try {
			await invoke("gdrive_cancel_upload", { uploadId });
		} catch (e) {
			console.error("[gdrive] cancel failed", e);
		}
	}

	function dismissUpload(uploadId: string) {
		delete uploads[uploadId];
	}

	/**
	 * Drop a path from upload history. Call when a local file is deleted
	 * so its row stops claiming it was uploaded. The Drive file itself
	 * isn't touched.
	 */
	async function forgetUpload(localPath: string) {
		delete uploadHistory[localPath];
		if (!(await isTauriApp())) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("gdrive_forget_upload", { localPath });
		} catch (e) {
			console.error("[gdrive] forget failed", e);
		}
	}

	/** Look up the persisted record for a local export, if any. */
	function getRecordForPath(localPath: string): UploadRecord | undefined {
		return uploadHistory[localPath];
	}

	/**
	 * Look up an in-flight upload by its source file path. Used by list
	 * views to render per-row progress without forcing every row to
	 * scan the uploads map on every keystroke. Returns the most recently
	 * started match if (somehow) multiple uploads target the same path.
	 */
	function getActiveUploadForPath(
		localPath: string,
	): GdriveUpload | undefined {
		const list = Object.values(uploads).filter(
			(u) => u.sourcePath === localPath && u.status === "uploading",
		);
		// Most recent uploadId wins (uploadIds are timestamp-prefixed in
		// `upload()`, so lexicographic max = most recent).
		list.sort((a, b) => b.uploadId.localeCompare(a.uploadId));
		return list[0];
	}

	return {
		get connected() {
			return connected;
		},
		get email() {
			return email;
		},
		get connecting() {
			return connecting;
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

		/** Wire event listeners and pull current status + history. Safe to call repeatedly. */
		async init() {
			await attachListeners();
			await refreshStatus();
			await refreshHistory();
		},

		refreshStatus,
		refreshHistory,
		connect,
		disconnect,
		upload,
		cancelUpload,
		dismissUpload,
		forgetUpload,
		getRecordForPath,
		getActiveUploadForPath,
	};
}

export const gdrive = createGdriveStore();
