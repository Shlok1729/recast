import { error, json } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { getAuth } from "$lib/auth/server";
import { getDb } from "$lib/db";
import { member } from "$lib/db/schema";
import { getQuotaSnapshot, storagePctUsed } from "$lib/storage/quota";
import type { RequestHandler } from "./$types";

type SessionShape = {
	user: { id: string; activeOrganizationId?: string | null };
};

/**
 * GET /api/workspaces/me/quota
 *
 * Snapshot of the caller's active-workspace usage vs plan caps. Used by
 * the dashboard usage meter and the upload-button enable/disable state.
 *
 * Query `?workspaceId=...` overrides the session's active org for the
 * org-switcher's preview hover. Membership is enforced either way.
 *
 * Response shape stays deliberately flat — `Number.POSITIVE_INFINITY`
 * doesn't survive JSON.stringify (becomes `null`), so we coerce to
 * `null` explicitly for the unlimited Enterprise tier.
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

	const snap = await getQuotaSnapshot(workspaceId);
	if (!snap) error(404, "Workspace not found");

	const pct = storagePctUsed(snap);

	const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

	return json({
		ok: true,
		workspaceId,
		plan: snap.plan,
		usage: {
			storageBytes: snap.usage.storageBytes,
			activeRecastsCount: snap.usage.activeRecastsCount,
			archivedRecastsCount: snap.usage.archivedRecastsCount,
			membersCount: snap.usage.membersCount,
		},
		limits: {
			storageBytes: finite(snap.limits.storageBytes),
			activeRecasts: finite(snap.limits.activeRecasts),
			members: finite(snap.limits.members),
			maxDurationSec: finite(snap.limits.maxDurationSec),
			playbackMaxHeight: snap.limits.playbackMaxHeight,
		},
		storagePctUsed: pct,
	});
};
