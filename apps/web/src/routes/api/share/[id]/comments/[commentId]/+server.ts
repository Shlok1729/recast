import { error, json } from "@sveltejs/kit";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "$lib/db";
import { shareComment } from "$lib/db/schema";
import { gateShareAccess } from "$lib/share/gate";
import type { RequestHandler } from "./$types";

/**
 * DELETE /api/share/[id]/comments/[commentId]?sessionId=…
 *
 * Soft-deletes a comment. Allowed for the share owner/admin (moderation) or
 * the original author (matched on the anonymous `sessionId`). Soft delete
 * keeps row counts and any future thread context intact.
 */
export const DELETE: RequestHandler = async ({ params, request, cookies, url }) => {
	const gate = await gateShareAccess(params.id, request, cookies);
	const sessionId = url.searchParams.get("sessionId") ?? "";

	const db = getDb();
	const [row] = await db
		.select({ sessionId: shareComment.sessionId })
		.from(shareComment)
		.where(
			and(
				eq(shareComment.id, params.commentId),
				eq(shareComment.shareSlug, params.id),
				isNull(shareComment.deletedAt),
			),
		)
		.limit(1);
	if (!row) error(404, "Comment not found");

	const isAuthor = sessionId !== "" && row.sessionId === sessionId;
	if (!gate.canManage && !isAuthor) error(403, "Not allowed to delete this comment");

	await db
		.update(shareComment)
		.set({ deletedAt: new Date() })
		.where(eq(shareComment.id, params.commentId));

	return json({ ok: true });
};
