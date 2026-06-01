import { desc, eq, ne, and, sql } from "drizzle-orm";
import { getDb } from "$lib/db";
import { folder, recast, share, tag } from "$lib/db/schema";
import type { PageServerLoad } from "./$types";

/**
 * Full library loader. Larger limit than the home page; archived rows
 * are excluded since they live behind their own tab (not built yet —
 * trivial follow-up: parametrize on `?status=archived`).
 *
 * Returns the recast list (each with its `folderId` + `tags` id array),
 * plus the workspace's folder tree and tag set, so the library can render
 * organization without extra client round-trips on first paint.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { activeOrganization } = await parent();
	const db = getDb();
	const workspaceId = activeOrganization.id;

	const [rows, folders, tags] = await Promise.all([
		db
			.select({
				id: recast.id,
				title: recast.title,
				durationSec: recast.durationSec,
				sizeBytes: recast.sizeBytes,
				source: recast.source,
				provider: recast.provider,
				status: recast.status,
				folderId: recast.folderId,
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
				// Tag id array per recast — resolved against the `tags` list
				// below in the UI. `[]` when untagged.
				tags: sql<string[]>`COALESCE((
					SELECT json_agg(rt.tag_id)
					FROM recast_tag rt
					WHERE rt.recast_id = ${recast.id}
				), '[]'::json)`,
			})
			.from(recast)
			.where(and(eq(recast.workspaceId, workspaceId), ne(recast.status, "archived")))
			.orderBy(desc(recast.createdAt))
			.limit(200),
		db
			.select({
				id: folder.id,
				parentId: folder.parentId,
				name: folder.name,
				color: folder.color,
				path: folder.path,
			})
			.from(folder)
			.where(eq(folder.workspaceId, workspaceId)),
		db
			.select({ id: tag.id, name: tag.name, color: tag.color })
			.from(tag)
			.where(eq(tag.workspaceId, workspaceId)),
	]);

	return {
		workspaceId,
		recasts: rows.map((r) => ({
			...r,
			sizeBytes: Number(r.sizeBytes),
			views: Number(r.views ?? 0),
			createdAt: r.createdAt.getTime(),
			tags: r.tags ?? [],
		})),
		folders,
		tags,
	};
};
