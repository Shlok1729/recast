import { eq, sql } from "drizzle-orm";
import { getDb } from "$lib/db";
import { organization } from "$lib/db/schema/organization";
import { QUOTA, workspaceUsage } from "$lib/db/schema/usage";

// Drizzle's transaction callback yields a tx-bound instance with the same
// query surface as the top-level db but a different concrete type
// (PgTransaction, no `$client`). Strip `$client` so both are assignable —
// the bumpUsage / decrementUsage functions only call insert/update.
type DbLike = Omit<ReturnType<typeof getDb>, "$client">;

/**
 * Quota math + workspace_usage maintenance.
 *
 * Source of truth is the recast table sums; workspace_usage is a cached
 * mirror updated transactionally on upload/delete/archive and reconciled
 * by a nightly cron (not in this turn). Both reads and writes here are
 * cheap — single-row primary-key lookups on (workspace_id).
 */

type PlanKey = keyof typeof QUOTA;

function planKey(plan: string | null | undefined): PlanKey {
	if (plan === "pro" || plan === "enterprise") return plan;
	return "free";
}

export type QuotaSnapshot = {
	plan: PlanKey;
	usage: {
		storageBytes: number;
		activeRecastsCount: number;
		archivedRecastsCount: number;
		membersCount: number;
	};
	limits: (typeof QUOTA)[PlanKey];
};

/**
 * Single-trip read of plan + usage. Returns `null` if the workspace
 * doesn't exist — caller decides whether that's a 404 or auto-init.
 */
export async function getQuotaSnapshot(
	workspaceId: string,
): Promise<QuotaSnapshot | null> {
	const db = getDb();

	const [org] = await db
		.select({ plan: organization.plan })
		.from(organization)
		.where(eq(organization.id, workspaceId))
		.limit(1);
	if (!org) return null;

	const [usage] = await db
		.select()
		.from(workspaceUsage)
		.where(eq(workspaceUsage.workspaceId, workspaceId))
		.limit(1);

	const plan = planKey(org.plan);

	return {
		plan,
		limits: QUOTA[plan],
		usage: {
			storageBytes: usage?.storageBytes ?? 0,
			activeRecastsCount: usage?.activeRecastsCount ?? 0,
			archivedRecastsCount: usage?.archivedRecastsCount ?? 0,
			membersCount: usage?.membersCount ?? 1,
		},
	};
}

/**
 * Failure reason returned by `checkUploadAllowed`. Single discriminated
 * union so the API endpoint can translate each into the right error code
 * and a user-facing copy line on the dashboard.
 */
export type UploadDenial =
	| { reason: "workspace_not_found" }
	| { reason: "duration_over_cap"; capSec: number }
	| {
			reason: "active_recasts_over_cap";
			current: number;
			cap: number;
	  }
	| {
			reason: "storage_over_cap";
			currentBytes: number;
			requestedBytes: number;
			capBytes: number;
	  };

/**
 * Pre-upload gate. Caller passes the **declared** file size and duration
 * from the desktop's local file metadata. Bytes are advisory at this
 * stage — `/api/uploads/complete` re-checks the actual R2-reported size
 * before committing the workspace_usage bump, so a client lying about
 * size only buys an empty signed URL.
 */
export function checkUploadAllowed(
	snapshot: QuotaSnapshot,
	req: { sizeBytes: number; durationSec: number },
): { ok: true } | { ok: false; denial: UploadDenial } {
	const { limits, usage } = snapshot;

	if (req.durationSec > limits.maxDurationSec) {
		return {
			ok: false,
			denial: { reason: "duration_over_cap", capSec: limits.maxDurationSec },
		};
	}

	if (usage.activeRecastsCount >= limits.activeRecasts) {
		return {
			ok: false,
			denial: {
				reason: "active_recasts_over_cap",
				current: usage.activeRecastsCount,
				cap: limits.activeRecasts,
			},
		};
	}

	const projected = usage.storageBytes + req.sizeBytes;
	if (projected > limits.storageBytes) {
		return {
			ok: false,
			denial: {
				reason: "storage_over_cap",
				currentBytes: usage.storageBytes,
				requestedBytes: req.sizeBytes,
				capBytes: limits.storageBytes,
			},
		};
	}

	return { ok: true };
}

/**
 * Bump usage counters after a successful upload. Idempotent on retry only
 * if the caller wraps it in the same transaction that flipped recast
 * status; otherwise a double-call will double-count. Endpoints SHOULD do
 * the recast UPDATE + this UPSERT in a single `db.transaction`.
 */
export async function bumpUsageOnUpload(
	workspaceId: string,
	sizeBytes: number,
	tx?: DbLike,
): Promise<void> {
	const db = tx ?? getDb();
	await db
		.insert(workspaceUsage)
		.values({
			workspaceId,
			storageBytes: sizeBytes,
			activeRecastsCount: 1,
		})
		.onConflictDoUpdate({
			target: workspaceUsage.workspaceId,
			set: {
				storageBytes: sql`${workspaceUsage.storageBytes} + ${sizeBytes}`,
				activeRecastsCount: sql`${workspaceUsage.activeRecastsCount} + 1`,
				updatedAt: new Date(),
			},
		});
}

/**
 * Reverse the bump when a recast is deleted (not archived — archive zeroes
 * `sizeBytes` and decrements active, but keeps the archived counter).
 */
export async function decrementUsageOnDelete(
	workspaceId: string,
	sizeBytes: number,
	tx?: DbLike,
): Promise<void> {
	const db = tx ?? getDb();
	await db
		.update(workspaceUsage)
		.set({
			// GREATEST guards against drift sending the counter negative.
			storageBytes: sql`GREATEST(${workspaceUsage.storageBytes} - ${sizeBytes}, 0)`,
			activeRecastsCount: sql`GREATEST(${workspaceUsage.activeRecastsCount} - 1, 0)`,
			updatedAt: new Date(),
		})
		.where(eq(workspaceUsage.workspaceId, workspaceId));
}

/** % of the storage cap currently used. 0–100, clamped. */
export function storagePctUsed(snapshot: QuotaSnapshot): number {
	if (!Number.isFinite(snapshot.limits.storageBytes)) return 0;
	const pct = (snapshot.usage.storageBytes / snapshot.limits.storageBytes) * 100;
	return Math.min(100, Math.max(0, pct));
}
