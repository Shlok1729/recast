import { error, json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { getAuth } from "$lib/auth/server";
import { getDb } from "$lib/db";
import { share, shareView } from "$lib/db/schema";
import { resolveShareManage } from "$lib/share/manage";
import type { RequestHandler } from "./$types";

type SessionShape = { user: { id: string } };

/**
 * DELETE /api/share/[id]
 *
 * Revoke a share link. Manageable by the share owner, an owner/admin of the
 * recast's workspace, or a global admin (see `resolveShareManage`).
 *
 * `share_member` / `share_comment` / `share_reaction` cascade on the slug FK;
 * `share_view` has no cascade, so we clear its rows explicitly in the same
 * transaction — otherwise a deleted link would keep inflating view analytics.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const session = (await getAuth()
		.api.getSession({ headers: request.headers })
		.catch(() => null)) as SessionShape | null;
	if (!session?.user) error(401, "Sign in required");

	const manage = await resolveShareManage(params.id, session.user.id);
	if (!manage) error(404, "Share not found");
	if (!manage.canManage) error(403, "Not allowed to delete this share");

	const db = getDb();
	await db.transaction(async (tx) => {
		await tx.delete(shareView).where(eq(shareView.shareId, params.id));
		await tx.delete(share).where(eq(share.slug, params.id));
	});

	return json({ ok: true });
};
