/**
 * Real viewer-activity loader. Reads the `share_view` rows the player records
 * (via POST /api/share/[id]/view) and the workspace's shares, joins them up to
 * the owning recast, and projects both into the shared `Activity` shape the
 * Home + Analytics surfaces render. Replaces the old deterministic mock.
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "$lib/db";
import { recast, share, shareView } from "$lib/db/schema";
import type { Activity } from "./activity";

let regionNames: Intl.DisplayNames | null = null;
function viewerLabel(country: string | null): string {
	if (!country) return "Anonymous viewer";
	try {
		regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
		const name = regionNames.of(country.toUpperCase());
		return name ? `Viewer from ${name}` : "Anonymous viewer";
	} catch {
		return "Anonymous viewer";
	}
}

/**
 * Load the workspace's viewer activity — view/completion events plus
 * share-created events — newest first. `limit` caps each source independently;
 * the merged list is what the pages slice by date range.
 */
export async function loadWorkspaceActivity(
	workspaceId: string,
	limit = 250,
): Promise<Activity[]> {
	const db = getDb();

	const [viewRows, shareRows] = await Promise.all([
		db
			.select({
				id: shareView.id,
				recastId: recast.id,
				recastTitle: recast.title,
				sessionId: shareView.sessionId,
				country: shareView.country,
				completed: shareView.completed,
				watchPct: shareView.watchPct,
				createdAt: shareView.createdAt,
			})
			.from(shareView)
			.innerJoin(share, eq(shareView.shareId, share.slug))
			.innerJoin(recast, eq(share.recastId, recast.id))
			.where(eq(recast.workspaceId, workspaceId))
			.orderBy(desc(shareView.createdAt))
			.limit(limit),
		db
			.select({
				slug: share.slug,
				recastId: recast.id,
				recastTitle: recast.title,
				createdAt: share.createdAt,
			})
			.from(share)
			.innerJoin(recast, eq(share.recastId, recast.id))
			.where(eq(recast.workspaceId, workspaceId))
			.orderBy(desc(share.createdAt))
			.limit(limit),
	]);

	const views: Activity[] = viewRows.map((r) => ({
		id: r.id,
		recastId: r.recastId,
		recastTitle: r.recastTitle,
		viewer: viewerLabel(r.country),
		sessionId: r.sessionId,
		kind: r.completed ? "completed" : "viewed",
		timestamp: (r.createdAt ?? new Date(0)).getTime(),
		watchPct: r.watchPct,
	}));

	const shares: Activity[] = shareRows.map((r) => ({
		id: `${r.slug}-shared`,
		recastId: r.recastId,
		recastTitle: r.recastTitle,
		viewer: "You",
		kind: "shared",
		timestamp: (r.createdAt ?? new Date(0)).getTime(),
		watchPct: 0,
	}));

	return [...views, ...shares].sort((a, b) => b.timestamp - a.timestamp);
}
