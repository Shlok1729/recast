/**
 * The event taxonomy — the single source of truth for every product-analytics
 * event Recast emits, shared by both the web app and the desktop app so the
 * names never drift between surfaces.
 *
 * Conventions:
 *   - `snake_case`, `object_action`, past tense for completed actions
 *     (`export_completed`, not `complete_export`).
 *   - Properties are flat, `snake_case`, and carry **no PII** — no filenames,
 *     absolute paths, share slugs, emails, or hostnames. IDs only when they're
 *     non-identifying (a visibility enum, a codec name, a duration).
 *   - Add an event by extending `ANALYTICS_EVENTS`; add a typed prop shape in
 *     `EventPropMap` if call sites should be constrained.
 *
 * Global super-properties (`app_version`, `os`, `source`, `user_plan`,
 * `user_type`) are registered once at init by each app's analytics client and
 * merged into every event — do NOT pass them per-call.
 */

export const ANALYTICS_EVENTS = [
	"app_opened",
	"recording_started",
	"recording_stopped",
	"recording_paused",
	"export_started",
	"export_completed",
	"export_failed",
	"recast_uploaded",
	"share_created",
	"share_viewed",
	"editor_opened",
	"cloud_connected",
	"sign_in",
	"sign_out",
	"consent_granted",
	"consent_revoked",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Optional typed prop shapes for the events worth constraining. Call sites can
 * import these to get autocomplete + a compile error if they pass the wrong
 * field — but `capture` stays permissive for events not listed here.
 */
export interface EventPropMap {
	recording_stopped: {
		duration_ms?: number;
		source_kind?: string;
		has_camera?: boolean;
		has_mic?: boolean;
		has_system_audio?: boolean;
	};
	export_completed: {
		format?: string;
		duration_ms?: number;
		output_bytes?: number;
		encoder?: string;
	};
	export_failed: {
		reason?: string;
		encoder?: string;
	};
	share_created: {
		visibility: "private" | "workspace" | "selected" | "public";
		has_password?: boolean;
		has_expiry?: boolean;
		watermark?: boolean;
	};
	share_viewed: {
		visibility?: string;
		watch_pct?: number;
		completed?: boolean;
		/** The anonymous `shareView` session id, so PostHog reconciles with the
		 * first-party watch-metrics table. Viewers are NOT identified. */
		share_session_id?: string;
	};
	recast_uploaded: {
		size_bytes?: number;
		width?: number;
		height?: number;
		fps?: number;
	};
}
