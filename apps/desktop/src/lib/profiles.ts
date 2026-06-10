/**
 * Recording profile types, migration, and pure resolution helpers.
 *
 * The reactive store lives in `stores/profiles.svelte.ts`; this module is the
 * non-reactive core so it can be tested standalone and imported from
 * non-component code (panel page, IPC layer, etc.).
 */

import { safeStorage } from "@recast/ui/persisted-state";
import type { AudioDeviceInfo } from "$lib/ipc";
import type { BrowserCamera } from "$lib/camera/browser-devices";
import { findCamera } from "$lib/camera/browser-devices";

/** Stored profile record. v2 schema — adds device identity fields over v1. */
export interface RecordingProfile {
	id: string;
	name: string;
	systemAudio: boolean;
	microphone: boolean;
	/** Tauri/Rust audio device id; null = use system default when applied. */
	micDeviceId: string | null;
	/** Display label for the saved mic; used as fallback identity if id stale. */
	micLabel: string | null;
	camera: boolean;
	/** DirectShow-friendly name — what the Rust recorder consumes. */
	cameraLabel: string | null;
	/** Browser MediaDevices id — what the camera-preview window consumes. */
	cameraDeviceId: string | null;
	/**
	 * Per-profile countdown override (seconds) before capture starts. `null`
	 * or absent means "inherit the global Settings → Recording countdown";
	 * `0` explicitly disables the countdown for this profile. Lets a "quick
	 * capture" profile start instantly while a "presentation" profile waits.
	 * Part of the capability fingerprint (`capSig`) and the combination cap —
	 * the pre-roll is a real differentiator, so "Screen, instant" and
	 * "Screen, 5s" are two valid profiles that share devices but differ by
	 * countdown. The option space is `COUNTDOWN_OPTIONS`.
	 */
	countdown?: number | null;
	isDefault: boolean;
}

/** Pre-v2 (capability-only) shape, kept for migration. */
interface RecordingProfileV1 {
	id: string;
	name: string;
	systemAudio: boolean;
	microphone: boolean;
	camera: boolean;
	isDefault: boolean;
}

export const PROFILES_STORAGE_KEY = "recast-recording-profiles";
export const PROFILES_ENABLED_STORAGE_KEY = "recast-profiles-enabled";

// ---------- Global capture quality + frame rate ----------
//
// Capture rate and quality are capture-WIDE preferences (like the global
// countdown), not per-device-combo settings, so they live outside the
// profile records — this keeps them clear of the profile capability
// fingerprint (`capSig`) and combination cap. Persisted globally and applied
// to every recording regardless of which profile is active.

export const RECORDING_QUALITY_STORAGE_KEY = "recast-recording-quality";
export const RECORDING_FPS_STORAGE_KEY = "recast-recording-fps";

/** Capture quality tier — mirrors the Rust `RecordingQuality` enum. */
export type RecordingQuality = "balanced" | "high" | "pristine";

/** Read the persisted capture quality tier. Defaults to "balanced" (the
 *  historical behavior); any unrecognized value falls back to it too. */
export function loadRecordingQuality(): RecordingQuality {
	const v = safeStorage.get<string>(RECORDING_QUALITY_STORAGE_KEY, "balanced");
	return v === "high" || v === "pristine" ? v : "balanced";
}

export function persistRecordingQuality(q: RecordingQuality): void {
	safeStorage.set(RECORDING_QUALITY_STORAGE_KEY, q);
}

/** Read the persisted capture frame rate. `null` = "Auto" (backend default
 *  60). Out-of-range values are coerced back to `null`. */
export function loadRecordingFps(): number | null {
	const v = safeStorage.get<number | null>(RECORDING_FPS_STORAGE_KEY, null);
	return typeof v === "number" && v >= 24 && v <= 240 ? Math.round(v) : null;
}

export function persistRecordingFps(fps: number | null): void {
	safeStorage.set(RECORDING_FPS_STORAGE_KEY, fps);
}

/** Sentinel slot for "use system default at recording time" — distinct from
 *  any specific device id, and distinct from "off". */
const DEFAULT_SLOT = "default";
const OFF_SLOT = "off";

/**
 * Per-profile countdown override option space — the single source of truth
 * shared by the editor UI, the dedup key (`capSig`), and the combination cap
 * (`maxCombinations` / `firstFreeCombo` / `freeSlots`). `null` = inherit the
 * global countdown; `0` = off; the rest pin an explicit pre-roll. Each value
 * is a distinct slot, so two profiles may share devices yet differ by
 * countdown alone. Keep `null` first so the auto-pick walk exhausts every
 * device combo at "inherit" before introducing pinned countdowns.
 */
export const COUNTDOWN_OPTIONS: readonly (number | null)[] = [
	null,
	0,
	3,
	5,
	10,
];

/** Stable slot token for a countdown value, used in `capSig` and combo walks.
 *  `null`/absent → "inherit"; otherwise the literal seconds. */
export function countdownToken(cd: number | null | undefined): string {
	return cd == null ? "inherit" : String(cd);
}

/** Public profile combo shape: each side is the on/off + device identity.
 *  `null` deviceId with kind=true means "use system default at runtime". */
export type ProfileCombo = {
	systemAudio: boolean;
	microphone: boolean;
	micDeviceId: string | null;
	camera: boolean;
	cameraDeviceId: string | null;
	/** Countdown override for the auto-picked slot (`null` = inherit global). */
	countdown: number | null;
};

function micSlot(
	p: Pick<RecordingProfile, "microphone" | "micDeviceId">,
): string {
	if (!p.microphone) return OFF_SLOT;
	return p.micDeviceId ?? DEFAULT_SLOT;
}
function camSlot(
	p: Pick<RecordingProfile, "camera" | "cameraDeviceId">,
): string {
	if (!p.camera) return OFF_SLOT;
	return p.cameraDeviceId ?? DEFAULT_SLOT;
}

/**
 * Capability fingerprint — uniqueness key for dedup, **including** device
 * identity. Two profiles with the same on/off shape but different mic/cam
 * IDs are intentionally distinct presets (e.g. "Studio" with the Yeti vs
 * "Mobile" with AirPods is two valid profiles).
 *
 * Slot vocabulary: `off` (capability disabled), `default` (enabled but no
 * specific device pinned — runtime picks the system default), or a literal
 * device id. The trailing segment is the countdown slot (`inherit` or the
 * literal seconds) so profiles can differ by pre-roll alone — see
 * `COUNTDOWN_OPTIONS`.
 */
export function capSig(p: RecordingProfile): string {
	return `${+p.systemAudio}|${micSlot(p)}|${camSlot(p)}|${countdownToken(p.countdown)}`;
}

/**
 * Total possible profile slots given currently-attached devices.
 * Math: `#countdowns × 2 (sysAudio) × (2 + #mics) × (2 + #cams)` — each kind's
 * slot space is { off, default, ...each specific device }, multiplied by the
 * per-profile countdown override options (`COUNTDOWN_OPTIONS`). With 0 mics
 * and 0 cams this is `#countdowns × 8` (5 × 8 = 40 for the default options).
 */
export function maxCombinations(micCount: number, camCount: number): number {
	return COUNTDOWN_OPTIONS.length * 2 * (2 + micCount) * (2 + camCount);
}

interface DeviceLite {
	id: string;
	name: string;
}
interface CameraLite {
	deviceId: string;
	label: string;
}

/**
 * First combo (walking the full cartesian product of currently-attached
 * devices) that no profile in `list` already uses. Returns null when every
 * attainable slot is taken.
 *
 * Walk order is intentional: the first new profile a user creates gets a
 * "system audio + default mic + default cam" template, then "+ off cam",
 * etc. Specific device ids come last so a fresh user with one mic doesn't
 * land on the literal-id slot before exhausting the off/default slots.
 * Countdown is the outermost dimension with `inherit` first, so the whole
 * device cartesian is exhausted at "inherit the global countdown" before any
 * pinned pre-roll is auto-assigned.
 */
export function firstFreeCombo(
	list: RecordingProfile[],
	mics: DeviceLite[],
	cams: CameraLite[],
): ProfileCombo | null {
	const taken = new Set(list.map(capSig));

	const micOptions: { slot: string; id: string | null }[] = [
		{ slot: OFF_SLOT, id: null },
		{ slot: DEFAULT_SLOT, id: null },
		...mics.map((m) => ({ slot: m.id, id: m.id })),
	];
	const camOptions: { slot: string; id: string | null }[] = [
		{ slot: OFF_SLOT, id: null },
		{ slot: DEFAULT_SLOT, id: null },
		...cams.map((c) => ({ slot: c.deviceId, id: c.deviceId })),
	];

	for (const cd of COUNTDOWN_OPTIONS) {
		const cdSlot = countdownToken(cd);
		for (const sa of [true, false]) {
			for (const mic of micOptions) {
				for (const cam of camOptions) {
					const sig = `${+sa}|${mic.slot}|${cam.slot}|${cdSlot}`;
					if (taken.has(sig)) continue;
					return {
						systemAudio: sa,
						microphone: mic.slot !== OFF_SLOT,
						micDeviceId: mic.id,
						camera: cam.slot !== OFF_SLOT,
						cameraDeviceId: cam.id,
						countdown: cd,
					};
				}
			}
		}
	}
	return null;
}

/** Enforce the "exactly one default" invariant in-place (returns a new array). */
export function ensureExactlyOneDefault(
	list: RecordingProfile[],
): RecordingProfile[] {
	if (list.length === 0) return list;
	const defaults = list.filter((p) => p.isDefault);
	if (defaults.length === 1) return list;
	if (defaults.length === 0) {
		return list.map((p, i) => (i === 0 ? { ...p, isDefault: true } : p));
	}
	let seen = false;
	return list.map((p) => {
		if (p.isDefault && !seen) {
			seen = true;
			return p;
		}
		return p.isDefault ? { ...p, isDefault: false } : p;
	});
}

/** Hand-build the seed set for first launch. Three profiles covering the
 *  most common shapes so users see the value of the system without having
 *  to click "New profile" before recording. */
export function seedProfiles(): RecordingProfile[] {
	const id = () => crypto.randomUUID();
	return [
		{
			id: id(),
			name: "Screen only",
			systemAudio: true,
			microphone: false,
			micDeviceId: null,
			micLabel: null,
			camera: false,
			cameraLabel: null,
			cameraDeviceId: null,
			isDefault: true,
		},
		{
			id: id(),
			name: "Tutorial",
			systemAudio: true,
			microphone: true,
			micDeviceId: null,
			micLabel: null,
			camera: false,
			cameraLabel: null,
			cameraDeviceId: null,
			isDefault: false,
		},
		{
			id: id(),
			name: "Presentation",
			systemAudio: true,
			microphone: true,
			micDeviceId: null,
			micLabel: null,
			camera: true,
			cameraLabel: null,
			cameraDeviceId: null,
			isDefault: false,
		},
	];
}

function isV1(p: unknown): p is RecordingProfileV1 {
	return (
		typeof p === "object" &&
		p !== null &&
		"id" in p &&
		"name" in p &&
		"systemAudio" in p &&
		"microphone" in p &&
		"camera" in p &&
		!("micDeviceId" in p)
	);
}

function isV2(p: unknown): p is RecordingProfile {
	return (
		typeof p === "object" &&
		p !== null &&
		"id" in p &&
		"micDeviceId" in p &&
		"cameraLabel" in p
	);
}

/**
 * Read profiles from localStorage. Migrates v1 rows forward (filling new
 * device fields with null). Returns `seedProfiles()` if storage is empty,
 * unparseable, or every entry was unrecognizable. Never throws.
 */
export function loadProfiles(): RecordingProfile[] {
	// `safeStorage` returns [] for missing key / no-window / malformed JSON /
	// non-array data — every empty-ish case funnels into the seed below.
	const parsed = safeStorage.get<unknown[]>(PROFILES_STORAGE_KEY, []);
	if (!Array.isArray(parsed) || parsed.length === 0) return seedProfiles();

	const migrated: RecordingProfile[] = [];
	for (const entry of parsed) {
		if (isV2(entry)) {
			migrated.push(entry);
			continue;
		}
		if (isV1(entry)) {
			migrated.push({
				...entry,
				micDeviceId: null,
				micLabel: null,
				cameraLabel: null,
				cameraDeviceId: null,
			});
			continue;
		}
		// Drop unrecognized rows silently — better than throwing on the whole list.
	}

	if (migrated.length === 0) return seedProfiles();
	return ensureExactlyOneDefault(migrated);
}

/** Persist profiles to localStorage. Silently no-ops if storage is unavailable. */
export function persistProfiles(list: RecordingProfile[]): void {
	safeStorage.set(PROFILES_STORAGE_KEY, list);
}

/** Read the on/off flag for the whole profile system. Defaults to enabled.
 *  The `true` fallback drives the boolean serializer, which reads the existing
 *  raw "true"/"false" values and returns true when the key is unset. */
export function loadProfilesEnabled(): boolean {
	return safeStorage.get<boolean>(PROFILES_ENABLED_STORAGE_KEY, true);
}

export function persistProfilesEnabled(enabled: boolean): void {
	safeStorage.set(PROFILES_ENABLED_STORAGE_KEY, enabled);
}

/** Pick the user's default profile, or the first one if no default flag is
 *  set. Returns null only when the list is empty. */
export function findDefaultProfile(
	list: RecordingProfile[],
): RecordingProfile | null {
	if (list.length === 0) return null;
	return list.find((p) => p.isDefault) ?? list[0];
}

// ---------- Device resolution ----------

export type DeviceResolution<T> =
	| { kind: "matched"; device: T }
	| {
		kind: "fallback";
		requestedLabel: string;
		device: T;
		reason: string;
	}
	| { kind: "missing"; requestedLabel: string }
	| { kind: "none" };

/**
 * Resolve a profile's saved mic against the currently available audio inputs.
 * Order:
 *   1. Saved deviceId still present → matched.
 *   2. Saved label matches a current device → fallback (id changed).
 *   3. System default exists → fallback (saved device gone).
 *   4. Nothing available → missing.
 *
 * Pure function — never reads from the store and never toasts. Callers
 * surface the result however the calling surface needs (panel toasts,
 * editor inline warnings, etc.).
 */
export function resolveMic(
	profile: RecordingProfile,
	available: AudioDeviceInfo[],
): DeviceResolution<AudioDeviceInfo> {
	if (!profile.microphone) return { kind: "none" };
	if (available.length === 0) {
		return {
			kind: "missing",
			requestedLabel: profile.micLabel ?? "Microphone",
		};
	}

	if (profile.micDeviceId) {
		const exact = available.find((d) => d.id === profile.micDeviceId);
		if (exact) return { kind: "matched", device: exact };
	}

	if (profile.micLabel) {
		const byLabel = available.find((d) => d.name === profile.micLabel);
		if (byLabel) {
			return {
				kind: "fallback",
				requestedLabel: profile.micLabel,
				device: byLabel,
				reason: "device id changed",
			};
		}
	}

	const def = available.find((d) => d.isDefault) ?? available[0];
	if (def && profile.micLabel) {
		return {
			kind: "fallback",
			requestedLabel: profile.micLabel,
			device: def,
			reason: "saved mic unavailable — using system default",
		};
	}
	if (def) return { kind: "matched", device: def };
	return {
		kind: "missing",
		requestedLabel: profile.micLabel ?? "Microphone",
	};
}

/**
 * Resolve a profile's saved camera against the WebView's enumerated cameras.
 * Uses the existing `findCamera` fuzzy matcher (label/id/partial), then
 * falls back to the first non-virtual cam. Same semantics as `resolveMic`.
 */
export function resolveCamera(
	profile: RecordingProfile,
	available: BrowserCamera[],
): DeviceResolution<BrowserCamera> {
	if (!profile.camera) return { kind: "none" };
	if (available.length === 0) {
		return {
			kind: "missing",
			requestedLabel: profile.cameraLabel ?? "Camera",
		};
	}

	const query = profile.cameraDeviceId ?? profile.cameraLabel;
	if (query) {
		const matched = findCamera(available, query);
		if (matched) {
			const exactId =
				profile.cameraDeviceId &&
				available.some((c) => c.deviceId === profile.cameraDeviceId);
			if (exactId) return { kind: "matched", device: matched };
			return {
				kind: "fallback",
				requestedLabel: profile.cameraLabel ?? query,
				device: matched,
				reason: "device id changed",
			};
		}
	}

	const def =
		available.find((c) => !c.isVirtual) ?? available[0] ?? null;
	if (def && (profile.cameraLabel || profile.cameraDeviceId)) {
		return {
			kind: "fallback",
			requestedLabel: profile.cameraLabel ?? profile.cameraDeviceId ?? "",
			device: def,
			reason: "saved camera unavailable — using system default",
		};
	}
	if (def) return { kind: "matched", device: def };
	return {
		kind: "missing",
		requestedLabel: profile.cameraLabel ?? "Camera",
	};
}
