/**
 * Viewer-activity shapes + aggregation helpers for the Home and Analytics
 * surfaces. The events themselves are loaded server-side from the real
 * `share_view` table (see `activity.server.ts`) — this module only defines the
 * shape and the pure roll-ups the pages compute from a `range`-filtered slice.
 */

export type ActivityKind = "viewed" | "completed" | "shared" | "downloaded";

export type Activity = {
	id: string;
	recastId: string;
	recastTitle: string;
	/** Human label for the row ("Anonymous viewer", "Viewer from India", "You"). */
	viewer: string;
	/** Anonymous session fingerprint for view events — the key we count unique
	 *  viewers by. Absent on non-view rows (e.g. "shared"). */
	sessionId?: string;
	/** ISO country code from the edge header, when known (view events only). */
	country?: string | null;
	kind: ActivityKind;
	timestamp: number;
	watchPct: number;
};

/** Only the "viewed"/"completed" rows represent an actual play. */
function viewEvents(activity: Activity[]): Activity[] {
	return activity.filter((a) => a.kind === "viewed" || a.kind === "completed");
}

/** Comments + reactions rollup for one recast (see `loadRecastEngagement`). */
export type RecastEngagement = {
	commentCount: number;
	reactionCount: number;
	/** Emoji → count, most-used first. */
	reactions: { emoji: string; count: number }[];
	recentComments: { authorName: string; body: string; atSeconds: number; createdAt: number }[];
};

/** Per-recast performance metrics for the workspace comparison table. */
export type RecastPerf = {
	views: number;
	avgWatch: number;
	completion: number;
	comments: number;
};

const DAY = 86_400_000;

/** Aggregate view events into daily buckets ending today. */
export function viewsByDay(
	activity: Activity[],
	days: number,
): { date: number; label: string; views: number }[] {
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const buckets: { date: number; label: string; views: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(todayStart);
		d.setDate(d.getDate() - i);
		buckets.push({
			date: d.getTime(),
			label:
				days <= 7
					? d.toLocaleDateString("en-US", { weekday: "short" })
					: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			views: 0,
		});
	}
	const start = buckets[0]!.date;
	for (const ev of activity) {
		if (ev.kind !== "viewed" && ev.kind !== "completed") continue;
		if (ev.timestamp < start) continue;
		const idx = Math.floor((ev.timestamp - start) / DAY);
		if (idx >= 0 && idx < buckets.length) buckets[idx]!.views++;
	}
	return buckets;
}

export function avgWatchPct(activity: Activity[]): number {
	const views = activity.filter((a) => a.kind === "viewed" || a.kind === "completed");
	if (views.length === 0) return 0;
	const sum = views.reduce((s, v) => s + v.watchPct, 0);
	return Math.round(sum / views.length);
}

/** Distinct viewers among view events, keyed by the anonymous session
 *  fingerprint (falls back to the display label when no session is attached). */
export function uniqueViewers(activity: Activity[]): number {
	const set = new Set<string>();
	for (const a of viewEvents(activity)) {
		set.add(a.sessionId ?? a.viewer);
	}
	return set.size;
}

/** % of plays that ran to the end (`completed`). The signal founders want:
 *  "do people actually finish?" — distinct from average watch %. */
export function completionRate(activity: Activity[]): number {
	const views = viewEvents(activity);
	if (views.length === 0) return 0;
	const finished = views.filter((a) => a.kind === "completed").length;
	return Math.round((finished / views.length) * 100);
}

/** Total play count (viewed + completed events). */
export function viewCount(activity: Activity[]): number {
	return viewEvents(activity).length;
}

/**
 * Watch-retention survival curve: for each decile threshold (10%…100%), the
 * share of plays that reached at least that far. Surfaces WHERE viewers drop
 * off rather than collapsing everything to one average. `reached` is 0–100.
 */
export function watchRetention(
	activity: Activity[],
): { pct: number; reached: number }[] {
	const views = viewEvents(activity);
	const total = views.length;
	const steps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
	return steps.map((pct) => {
		if (total === 0) return { pct, reached: 0 };
		const n = views.filter((v) => v.watchPct >= pct).length;
		return { pct, reached: Math.round((n / total) * 100) };
	});
}
