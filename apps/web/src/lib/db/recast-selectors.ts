import { sql } from "drizzle-orm";
import { recast, share } from "$lib/db/schema";

/**
 * Correlated-subquery select fragments for recast list loaders. Extracted so
 * the home, library, analytics, and API loaders share ONE definition each —
 * previously these were copy-pasted across four files, and drift (e.g. one
 * loader counting views differently) would silently desync the dashboards.
 *
 * Each returns a fresh `sql` fragment that correlates to the outer `recast`
 * table, so use them inside `.select({ ... }).from(recast)`.
 */

/** Total views for a recast = sum of its shares' cached view counts. */
export function recastViewsSql() {
	return sql<number>`COALESCE((
		SELECT SUM(${share.viewsCount})
		FROM ${share}
		WHERE ${share.recastId} = ${recast.id}
	), 0)`;
}

/** Slug of the recast's most recent share, or null if never shared. */
export function recastLatestShareSlugSql() {
	return sql<string | null>`(
		SELECT ${share.slug}
		FROM ${share}
		WHERE ${share.recastId} = ${recast.id}
		ORDER BY ${share.createdAt} DESC
		LIMIT 1
	)`;
}

/** Tag-id array for a recast (`[]` when untagged), resolved in the UI. */
export function recastTagIdsSql() {
	return sql<string[]>`COALESCE((
		SELECT json_agg(rt.tag_id)
		FROM recast_tag rt
		WHERE rt.recast_id = ${recast.id}
	), '[]'::json)`;
}
