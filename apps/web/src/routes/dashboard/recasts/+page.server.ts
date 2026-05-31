import { desc, eq, ne, and, sql } from "drizzle-orm";
import { getDb } from "$lib/db";
import { recast, share } from "$lib/db/schema";
import type { PageServerLoad } from "./$types";

/**
 * Full library loader. Larger limit than the home page; archived rows
 * are excluded since they live behind their own tab (not built yet —
 * trivial follow-up: parametrize on `?status=archived`).
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { activeOrganization } = await parent();
	const db = getDb();

	const rows = await db
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
		.where(
			and(
				eq(recast.workspaceId, activeOrganization.id),
				ne(recast.status, "archived"),
			),
		)
		.orderBy(desc(recast.createdAt))
		.limit(200);

	return {
		recasts: rows.map((r) => ({
			...r,
			sizeBytes: Number(r.sizeBytes),
			views: Number(r.views ?? 0),
			createdAt: r.createdAt.getTime(),
		})),
	};
};
