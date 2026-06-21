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
	| "timelineEditing"
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
		key: "timelineEditing",
		label: "Timeline editing (split & cut)",
		description:
			"Split clips and ripple-delete sections directly on the timeline. Early and still rough — opt in to try it. When off, the tools are hidden and any splits/cuts are ignored in playback and export.",
	},
	{
		key: "silenceDetection",
		label: "Silence detection & cuts",
		description:
			"Detect dead air (quiet audio + still cursor) and skip it during playback/export. Hidden when off.",
	},
	{
		key: "webcodecsPreview",
		label: "WebCodecs preview engine",
		description:
			"Decode the editor preview with WebCodecs and a custom playback clock instead of the HTML <video> element. Removes the freeze when playback crosses a cut/split. On unsupported hardware it falls back to the <video> path automatically. Toggle to compare smoothness against the classic engine.",
	},
	{
		key: "selfHosting",
		label: "Self-hosting server endpoint",
		description:
			"Point the app at your own Recast Cloud server. Recast Cloud isn't ready yet, so this is for early self-hosters only — leave off to use the default.",
	},
];

const DEFAULTS: Record<ExperimentalFlag, boolean> = {
	timelineEditing: false,
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
		get timelineEditing() {
			return flags.current.timelineEditing;
		},
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
