/**
 * Asset-pack extension orchestration.
 *
 * Keeps three things in sync:
 *   1. the Rust installer (download/verify/persist under app_data/extensions),
 *   2. `extensionsStore` (the panel's list + busy/error state),
 *   3. the asset `registry` (the visual entries packs contribute to pickers).
 *
 * Startup: `initExtensions()` enumerates installed packs (no network) and
 * registers the enabled ones. Install/uninstall/toggle keep all three in sync.
 */

import {
	fetchExtensionRegistry,
	installExtension,
	listInstalledExtensions,
	setExtensionEnabled,
	uninstallExtension,
	type InstalledExtension,
} from "$lib/ipc";
import { log } from "$lib/logger";
import { registerExtension, unregisterExtension } from "$lib/registry/extensions";
import { isTauriApp } from "$lib/runtime/tauri";
import { extensionsStore } from "$lib/stores/extensions-store.svelte";

/** Curated registry index URL (browse gallery). Override via env. */
const DEFAULT_REGISTRY_INDEX_URL =
	"https://github.com/kanakkholwal/recast/releases/download/extensions-v1/index.json";

export function registryIndexUrl(): string {
	const fromEnv = import.meta.env?.PUBLIC_EXTENSIONS_INDEX_URL;
	return typeof fromEnv === "string" && fromEnv.length > 0
		? fromEnv
		: DEFAULT_REGISTRY_INDEX_URL;
}

let initialised = false;

/** Enumerate installed packs and register the enabled ones. No network. */
async function hydrate(): Promise<void> {
	if (!(await isTauriApp())) return;
	try {
		const list = await listInstalledExtensions();
		extensionsStore.setAll(list);
		await Promise.all(list.map((ext) => registerExtension(ext)));
	} catch (err) {
		log.warn("extensions", "hydrate_failed", { err: String(err) });
	}
}

/** Call once from the root layout. Idempotent. */
export function initExtensions(): void {
	if (initialised) return;
	initialised = true;
	void hydrate();
}

/** Install (or update) a pack from a manifest URL, then register it. */
export async function installFromUrl(manifestUrl: string): Promise<InstalledExtension> {
	extensionsStore.setBusy(true);
	extensionsStore.setError(null);
	try {
		const ext = await installExtension(manifestUrl.trim());
		extensionsStore.upsert(ext);
		await registerExtension(ext);
		return ext;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		extensionsStore.setError(msg);
		throw err;
	} finally {
		extensionsStore.setBusy(false);
	}
}

/** Remove a pack and drop its registry entries. */
export async function removeExtension(extId: string): Promise<void> {
	extensionsStore.setBusy(true);
	try {
		await uninstallExtension(extId);
		unregisterExtension(extId);
		extensionsStore.remove(extId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		extensionsStore.setError(msg);
		throw err;
	} finally {
		extensionsStore.setBusy(false);
	}
}

/** Enable/disable a pack, updating both the store and the registry. */
export async function toggleExtension(extId: string, enabled: boolean): Promise<void> {
	extensionsStore.setBusy(true);
	try {
		await setExtensionEnabled(extId, enabled);
		const current = extensionsStore.installed.find((e) => e.manifest.id === extId);
		if (current) {
			const next = { ...current, enabled };
			extensionsStore.upsert(next);
			await registerExtension(next); // registers when enabled, clears when not
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		extensionsStore.setError(msg);
		throw err;
	} finally {
		extensionsStore.setBusy(false);
	}
}

/** Fetch the curated registry index for the browse gallery. */
export async function loadRegistryIndex<T = unknown>(): Promise<T | null> {
	if (!(await isTauriApp())) return null;
	try {
		return await fetchExtensionRegistry<T>(registryIndexUrl());
	} catch (err) {
		log.warn("extensions", "registry_index_failed", { err: String(err) });
		return null;
	}
}
