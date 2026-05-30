import {
	bigint,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";

/**
 * Per-workspace cached usage counters for the billing transparency surface
 * (storage bar, recast-count bar, live invoice estimate). One row per
 * workspace, upserted on every recast insert / delete / archive in the
 * same transaction. A nightly reconciliation cron recomputes from source
 * of truth (recast table sums) to repair drift.
 *
 * Quota limits themselves are NOT stored here — they're derived from
 * `organization.plan` via `TEAM_PLAN_*` constants. This table only holds
 * what the workspace is *currently using*.
 */
export const workspaceUsage = pgTable(
	"workspace_usage",
	{
		workspaceId: text("workspace_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Sum of `recast.size_bytes` for non-archived, non-deleted recasts. */
		storageBytes: bigint("storage_bytes", { mode: "number" })
			.notNull()
			.default(0),
		/** Count of recasts with status='published' (counts toward link cap). */
		activeRecastsCount: integer("active_recasts_count").notNull().default(0),
		/** Count of recasts in `archived` state — billed at $0 but visible to owner. */
		archivedRecastsCount: integer("archived_recasts_count").notNull().default(0),
		/** Workspace member count, kept in sync from `member` inserts/deletes. */
		membersCount: integer("members_count").notNull().default(1),
		/**
		 * Rolling 30d view count across all shares in the workspace. Used for
		 * the analytics overview card and abuse detection (sudden spike).
		 * Recomputed nightly from `share_view`.
		 */
		viewsLast30d: integer("views_last_30d").notNull().default(0),
		lastRecalculatedAt: timestamp("last_recalculated_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		// Quota-warning sweep: workspaces past 80% / 100% of their plan cap.
		index("workspace_usage_storage_idx").on(t.storageBytes),
	],
);

/**
 * Pricing constants. Single source of truth read everywhere quota or
 * invoice math runs. Keep aligned with the public pricing page and the
 * "Why this number" explainer.
 *
 * R2 floor: $0.015/GB/mo storage, $0 egress. Overage rate is ~2× floor.
 */
export const QUOTA = {
	free: {
		storageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
		activeRecasts: 10,
		maxDurationSec: 600, // 10 min
		members: 3,
		playbackMaxHeight: 720,
		expireAfterNoViewsDays: 14,
		hardDeleteAfterArchiveDays: 16, // 14 + 16 = 30d total
	},
	pro: {
		storageBytes: 200 * 1024 * 1024 * 1024, // 200 GB included
		activeRecasts: 200,
		maxDurationSec: 4 * 60 * 60, // 4 h
		members: 50,
		playbackMaxHeight: 2160,
		expireAfterNoViewsDays: null, // never auto-archive on Pro
		hardDeleteAfterArchiveDays: null,
	},
	enterprise: {
		storageBytes: Number.POSITIVE_INFINITY,
		activeRecasts: Number.POSITIVE_INFINITY,
		maxDurationSec: Number.POSITIVE_INFINITY,
		members: Number.POSITIVE_INFINITY,
		playbackMaxHeight: 2160,
		expireAfterNoViewsDays: null,
		hardDeleteAfterArchiveDays: null,
	},
} as const;

/** Pro overage rates. Charged via Polar metered billing on usage report. */
export const PRO_OVERAGE = {
	/** Per GB per month past included storage. ~2× R2 cost. */
	storagePerGbMonth: 0.03,
	/** Per active recast per month past included count. */
	perActiveRecastMonth: 0.1,
} as const;

export type WorkspaceUsage = typeof workspaceUsage.$inferSelect;
