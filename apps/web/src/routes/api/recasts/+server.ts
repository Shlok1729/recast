import { error, json } from "@sveltejs/kit";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getAuth } from "$lib/auth/server";
import { getDb } from "$lib/db";
import { member, recast, share } from "$lib/db/schema";
import type { RequestHandler } from "./$types";

type SessionShape = {
	user: { id: string; activeOrganizationId?: string | null };
};

/**
 * GET /api/recasts
 *
 * Lists recasts in the caller's workspace. Resolves the active workspace
 * from the session (`activeOrganizationId`) and enforces membership.
 *
 * Query params:
 *   - `workspaceId` (optional) — override the session's active org for
 *     a one-off listing (e.g. the org switcher reads from this before
 *     committing the switch)
 *   - `status` (optional) — filter by recast status; default excludes
 *     `archived` since the dashboard shows them under a separate tab
 *   - `limit` / `offset` — pagination, defaults 50 / 0
 *
 * Includes a denormalized `latestShareSlug` for each recast so the row
 * can render a "Copy link" button without a second fetch.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const session = (await getAuth()
		.api.getSession({ headers: request.headers })
		.catch(() => null)) as SessionShape | null;
	if (!session?.user) error(401, "Sign in required");

	const workspaceId =
		url.searchParams.get("workspaceId") ?? session.user.activeOrganizationId;
	if (!workspaceId) error(400, "No active workspace");

	const db = getDb();

	const [m] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.userId, session.user.id),
				eq(member.organizationId, workspaceId),
			),
		)
		.limit(1);
	if (!m) error(403, "Not a member of this workspace");

	const statusFilter = url.searchParams.get("status");
	const limit = Math.min(
		200,
		Math.max(1, Number(url.searchParams.get("limit")) || 50),
	);
	const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

	const where = statusFilter
		? and(
				eq(recast.workspaceId, workspaceId),
				eq(recast.status, statusFilter as "draft" | "published" | "archived"),
			)
		: and(
				eq(recast.workspaceId, workspaceId),
				// Exclude archived from default list; archived shows on its own tab.
				ne(recast.status, "archived"),
			);

	// One trip: recast rows + their most-recent share's slug + aggregated
	// view count. We materialize the aggregate via a lateral-ish subquery
	// so a recast with five shares still produces one row.
	const rows = await db
		.select({
			id: recast.id,
			title: recast.title,
			durationSec: recast.durationSec,
			sizeBytes: recast.sizeBytes,
			width: recast.width,
			height: recast.height,
			source: recast.source,
			provider: recast.provider,
			status: recast.status,
			folderId: recast.folderId,
			videoUrl: recast.videoUrl,
			posterUrl: recast.posterUrl,
			createdAt: recast.createdAt,
			lastViewedAt: recast.lastViewedAt,
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
			// Tag id array per recast (resolved against the workspace tag list
			// by the client). `[]` when untagged.
			tags: sql<string[]>`COALESCE((
				SELECT json_agg(rt.tag_id)
				FROM recast_tag rt
				WHERE rt.recast_id = ${recast.id}
			), '[]'::json)`,
		})
		.from(recast)
		.where(where)
		.orderBy(desc(recast.createdAt))
		.limit(limit)
		.offset(offset);

	return json({
		ok: true,
		workspaceId,
		recasts: rows.map((r) => ({
			...r,
			// Normalize SQL `bigint`s and `number`s to plain numbers.
			sizeBytes: Number(r.sizeBytes),
			views: Number(r.views ?? 0),
			createdAt: r.createdAt.getTime(),
			lastViewedAt: r.lastViewedAt ? r.lastViewedAt.getTime() : null,
			tags: r.tags ?? [],
		})),
	});
};
