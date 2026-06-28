/**
 * Experimental-features flags, shared across the settings page and any
 * surface that gates a feature behind one. Persisted to localStorage so the
 * choice survives reload; off by default so first-run users don't see
 * unfinished UI.
 *
 * Add a new flag by extending `ExperimentalFlag`, adding it to `DEFAULTS`,
 * and exposing a getter/setter pair on the store. The settings page reads
 * the registry via `FLAG_META` to render a row per flag without manual
 * wiring.
 */

import { PersistedState } from "@recast/ui/persisted-state";

export type ExperimentalFlag =
	| "silenceDetection"
	| "webcodecsPreview"
	| "selfHosting";

interface FlagMeta {
	key: ExperimentalFlag;
	label: string;
	description: string;
}

export const FLAG_META: FlagMeta[] = [
	{
		key: "silenceDetection",
		label: "Silence detection & cuts",
		description:
			"Find quiet stretches with no cursor movement and skip them on playback and export.",
	},
	{
		key: "webcodecsPreview",
		label: "WebCodecs preview engine",
		description:
			"Smoother editor playback across cuts and splits. Falls back to the standard player where it isn't supported.",
	},
	{
		key: "selfHosting",
		label: "Self-hosting server endpoint",
		description:
			"Point the app at your own Recast Cloud server. Cloud isn't ready yet, so this is for early self-hosters only.",
	},
];

// NOTE: timeline split/cut editing (formerly the `timelineEditing` flag) has
// GRADUATED to an always-on feature — its cut math is parity-tested against the
// Rust export (see cut-parity fixtures) and the timeline collapses cuts in
// output time. It no longer has a flag. Silence detection + WebCodecs stay
// opt-in until they clear their own validation gates.
const DEFAULTS: Record<ExperimentalFlag, boolean> = {
	silenceDetection: false,
	webcodecsPreview: false,
	selfHosting: false,
};

const STORAGE_KEY = "recast-experimental-flags";

function createExperimentalStore() {
	// Backed by the shared PersistedState primitive: synchronous first read,
	// JSON storage merged over DEFAULTS (so adding a flag later doesn't wipe a
	// user's saved choices), and cross-window `storage` sync. Tauri v2 webviews
	// share a localStorage origin, so flipping a flag in the settings window is
	// reflected in any open editor windows without a reload.
	const flags = new PersistedState<Record<ExperimentalFlag, boolean>>(STORAGE_KEY, DEFAULTS);

	return {
		get silenceDetection() {
			return flags.current.silenceDetection;
		},
		get webcodecsPreview() {
			return flags.current.webcodecsPreview;
		},
		isEnabled(key: ExperimentalFlag): boolean {
			return flags.current[key];
		},
		setEnabled(key: ExperimentalFlag, value: boolean) {
			flags.current = { ...flags.current, [key]: value };
		},
	};
}

export const experimentalStore = createExperimentalStore();
