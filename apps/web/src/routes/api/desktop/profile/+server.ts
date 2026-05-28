import { getAuth } from "$lib/auth/server";
import { PLANS, type PlanId } from "$lib/billing/plans";
import { getDb } from "$lib/db";
import {
	recast as recastTable,
	share as shareTable,
	subscription as subscriptionTable,
	user as userTable,
} from "$lib/db/schema";
import { and, count, eq, gt, isNull, or, sum } from "drizzle-orm";
import { error, json, type RequestHandler } from "@sveltejs/kit";

type SessionShape = {
	user: { id: string; email: string; name?: string | null; image?: string | null };
};

/**
 * Desktop "Sign in to Cloud" profile endpoint.
 *
 * Returns enough data for the desktop's Settings → Cloud signed-in card to
 * render a real user profile (avatar, plan badge, usage stats) without the
 * frontend needing N parallel calls. Authenticated via the bearer plugin —
 * the desktop passes `Authorization: Bearer <session.token>`.
 *
 * Why this endpoint (vs. just /api/auth/get-session): get-session only
 * returns the user row. We also need the user's plan (from `subscription`),
 * recordings count + storage usage (sum from `recast`), and active-share
 * count (from `share`). One round-trip is cheaper than three.
 */
export const GET: RequestHandler = async ({ request }) => {
	const auth = getAuth();
	const session = (await auth.api
		.getSession({ headers: request.headers })
		.catch(() => null)) as SessionShape | null;

	if (!session?.user?.id) throw error(401, "unauthorized");

	const db = getDb();
	const userId = session.user.id;

	// Run the three aggregate queries in parallel — they don't depend on each
	// other and each is cheap (single-table indexed scan / counter read).
	const [userRow, subRow, recastAgg, shareAgg] = await Promise.all([
		db
			.select({
				email: userTable.email,
				name: userTable.name,
				image: userTable.image,
				createdAt: userTable.createdAt,
			})
			.from(userTable)
			.where(eq(userTable.id, userId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select({
				plan: subscriptionTable.plan,
				status: subscriptionTable.status,
				currentPeriodEnd: subscriptionTable.currentPeriodEnd,
				cancelAtPeriodEnd: subscriptionTable.cancelAtPeriodEnd,
			})
			.from(subscriptionTable)
			.where(eq(subscriptionTable.userId, userId))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		db
			.select({
				recordings: count(),
				// Drizzle's `sum` returns string | null on PG for bigint columns;
				// coerce after the fetch.
				storage: sum(recastTable.sizeBytes),
			})
			.from(recastTable)
			.where(and(eq(recastTable.ownerId, userId), isNull(recastTable.deletedAt)))
			.then((rows) => rows[0] ?? { recordings: 0, storage: "0" }),
		db
			.select({ active: count() })
			.from(shareTable)
			.where(
				and(
					eq(shareTable.ownerId, userId),
					// "Active" = no expiry OR not yet expired.
					or(isNull(shareTable.expiresAt), gt(shareTable.expiresAt, new Date())),
				),
			)
			.then((rows) => rows[0] ?? { active: 0 }),
	]);

	if (!userRow) throw error(404, "user_not_found");

	// Default to free if there's no subscription row (the seed for new users
	// only inserts on Polar webhook). Same fallback the org plugin uses.
	const planId: PlanId = (subRow?.plan as PlanId | undefined) ?? "free";
	const plan = PLANS[planId];
	const sharesLimit = Number.isFinite(plan.limits.activeShares)
		? plan.limits.activeShares
		: null;

	return json({
		user: {
			email: userRow.email,
			name: userRow.name ?? null,
			image: userRow.image ?? null,
			memberSince: userRow.createdAt?.toISOString() ?? null,
		},
		plan: {
			id: plan.id,
			name: plan.name,
			status: subRow?.status ?? "active",
			currentPeriodEnd: subRow?.currentPeriodEnd?.toISOString() ?? null,
			cancelAtPeriodEnd: subRow?.cancelAtPeriodEnd ?? false,
		},
		usage: {
			recordings: Number(recastAgg.recordings) || 0,
			storageBytes: Number(recastAgg.storage ?? 0) || 0,
			activeShares: Number(shareAgg.active) || 0,
			sharesLimit, // null = unlimited
		},
	});
};
