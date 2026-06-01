import { error, json } from "@sveltejs/kit";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "$lib/db";
import { recast, recastTag, tag, user } from "$lib/db/schema";
import { requireUser } from "$lib/workspace/guard";
import type { RequestHandler } from "./$types";

/** Owner-or-admin gate; returns the recast's workspace for tag validation. */
async function authorizeRecast(request: Request, recastId: string): Promise<{ workspaceId: string }> {
	const u = await requireUser(request);
	const db = getDb();
	const [r] = await db
		.select({ ownerId: recast.ownerId, workspaceId: recast.workspaceId })
		.from(recast)
		.where(eq(recast.id, recastId))
		.limit(1);
	if (!r) error(404, "Recast not found");
	if (r.ownerId !== u.id) {
		const [usr] = await db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, u.id))
			.limit(1);
		if (usr?.role !== "admin") error(403, "Not allowed to modify this recast");
	}
	return { workspaceId: r.workspaceId };
}

/** GET /api/recasts/[id]/tags — the recast's current tags. */
export const GET: RequestHandler = async ({ params, request }) => {
	await authorizeRecast(request, params.id);
	const db = getDb();
	const rows = await db
		.select({ id: tag.id, name: tag.name, color: tag.color })
		.from(recastTag)
		.innerJoin(tag, eq(recastTag.tagId, tag.id))
		.where(eq(recastTag.recastId, params.id));
	return json({ ok: true, tags: rows });
};

/**
 * PUT /api/recasts/[id]/tags — replace the recast's tag set wholesale.
 * Body: { tagIds: string[] }. Every id must be a tag in the recast's own
 * workspace. Empty array clears all tags.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const { workspaceId } = await authorizeRecast(request, params.id);

	let body: { tagIds?: unknown } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, "Invalid JSON body");
	}
	if (!Array.isArray(body.tagIds)) error(400, "tagIds must be an array");
	const unique = [...new Set(body.tagIds.filter((x): x is string => typeof x === "string"))];

	const db = getDb();

	// Reject ids that don't belong to this workspace — no cross-workspace tags.
	if (unique.length > 0) {
		const valid = await db
			.select({ id: tag.id })
			.from(tag)
			.where(and(eq(tag.workspaceId, workspaceId), inArray(tag.id, unique)));
		if (valid.length !== unique.length) {
			error(400, "One or more tags don't belong to this workspace");
		}
	}

	await db.transaction(async (tx) => {
		await tx.delete(recastTag).where(eq(recastTag.recastId, params.id));
		if (unique.length > 0) {
			await tx
				.insert(recastTag)
				.values(unique.map((tagId) => ({ recastId: params.id, tagId })));
		}
	});

	return json({ ok: true, tagIds: unique });
};
