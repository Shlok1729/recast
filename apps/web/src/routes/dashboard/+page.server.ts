import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "$lib/db";
import { recast, share } from "$lib/db/schema";
import type { PageServerLoad } from "./$types";

/**
 * Dashboard home loader. The layout above has already resolved the
 * active workspace and quota — here we just fetch the most recent
 * non-archived recasts for the metrics cards, activity feed, and
 * "Top recasts" rail.
 *
 * Trimmed to 12 — enough to fill all three rails on the home page;
 * the full library lives at /dashboard/recasts.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { activeOrganization } = await parent();
	const db = getDb();

	const recasts = await db
		.select({
			id: recast.id,
			title: recast.title,
			durationSec: recast.durationSec,
			sizeBytes: recast.sizeBytes,
			source: recast.source,
			provider: recast.provider,
			status: recast.status,
			videoUrl: recast.videoUrl,
			posterUrl: recast.posterUrl,
			createdAt: recast.createdAt,
			views: sql<number>`COALESCE((
				SELECT SUM(${share.viewsCount})
				FROM ${share}
				WHERE ${share.recastId} = ${recast.id}
			), 0)`,
			latestShareSlug: sql<string | null>`(
				SELECT ${share.slug}
				FROM ${share}
				WHERE ${share.recastId} = ${recast.id}
				ORDER BY ${share.createdAt} DESC
				LIMIT 1
			)`,
		})
		.from(recast)
		.where(eq(recast.workspaceId, activeOrganization.id))
		.orderBy(desc(recast.createdAt))
		.limit(12);

	return {
		recasts: recasts
			.filter((r) => r.status !== "archived")
			.map((r) => ({
				...r,
				sizeBytes: Number(r.sizeBytes),
				views: Number(r.views ?? 0),
				createdAt: r.createdAt.getTime(),
			})),
	};
};

