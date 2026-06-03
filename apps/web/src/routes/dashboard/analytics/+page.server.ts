import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "$lib/db";
import { recast } from "$lib/db/schema";
import { loadWorkspaceActivity } from "$lib/dashboard/activity.server";
import { recastViewsSql } from "$lib/db/recast-selectors";
import type { PageServerLoad } from "./$types";

/**
 * Analytics loader. Pulls real viewer events from `share_view` (via
 * `loadWorkspaceActivity`) plus the workspace's recasts with their cached
 * view totals, so the charts, stat cards, and "Top recasts" rail all reflect
 * actual engagement instead of the old synthetic mock.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { activeOrganization } = await parent();
	const db = getDb();
	const workspaceId = activeOrganization.id;

	const [recasts, activity] = await Promise.all([
		db
			.select({
				id: recast.id,
				title: recast.title,
				durationSec: recast.durationSec,
				sizeBytes: recast.sizeBytes,
				source: recast.source,
				provider: recast.provider,
				createdAt: recast.createdAt,
				posterUrl: recast.posterUrl,
				views: recastViewsSql(),
			})
			.from(recast)
			.where(and(eq(recast.workspaceId, workspaceId), ne(recast.status, "archived")))
			.orderBy(desc(recast.createdAt))
			.limit(200),
		loadWorkspaceActivity(workspaceId),
	]);

	return {
		recasts: recasts.map((r) => ({
				id: r.id,
				title: r.title,
				durationSec: r.durationSec,
				sizeBytes: Number(r.sizeBytes),
				source: r.source,
				provider: r.provider,
				views: Number(r.views ?? 0),
				createdAt: r.createdAt.getTime(),
				posterUrl: r.posterUrl ?? "",
			})),
		activity,
	};
};
