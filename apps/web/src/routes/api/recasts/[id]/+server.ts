import { error, json } from "@sveltejs/kit";
import { eq, sql } from "drizzle-orm";
import { getAuth } from "$lib/auth/server";
import { getDb } from "$lib/db";
import { recast, user, workspaceUsage } from "$lib/db/schema";
import { decrementUsageOnDelete } from "$lib/storage/quota";
import { deleteObject } from "$lib/storage";
import type { RequestHandler } from "./$types";

type SessionShape = { user: { id: string; role?: string } };

/**
 * DELETE /api/recasts/[id]
 *
 * Permanently removes a cloud recast: the R2 blob, the row (its shares,
 * comments, reactions, and views cascade-delete via FK), and the
 * workspace_usage accounting.
 *
 * Usage reversal mirrors the expiry sweep's model:
 *   - `published` → reclaim storage + decrement active count
 *   - `archived`  → blob already gone / size 0; decrement archived count
 *   - `draft`     → never bumped usage; nothing to reverse
 *
 * Owner or global admin only. Idempotent-ish: a second call 404s once the
 * row is gone. This is the desktop "delete cloud copy" action — it never
 * touches the local `.recast`, which remains the source of truth.
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const session = (await getAuth()
		.api.getSession({ headers: request.headers })
		.catch(() => null)) as SessionShape | null;
	if (!session?.user) error(401, "Sign in required");

	const db = getDb();

	const [row] = await db
		.select({
			id: recast.id,
			ownerId: recast.ownerId,
			workspaceId: recast.workspaceId,
			videoUrl: recast.videoUrl,
			sizeBytes: recast.sizeBytes,
			status: recast.status,
		})
		.from(recast)
		.where(eq(recast.id, params.id))
		.limit(1);
	if (!row) error(404, "Recast not found");

	// Authorize: owner OR global admin. Re-read the role so a role change
	// takes effect immediately rather than waiting on session re-issue.
	const isOwner = row.ownerId === session.user.id;
	let isAdmin = false;
	if (!isOwner) {
		const [u] = await db
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, session.user.id))
			.limit(1);
		isAdmin = u?.role === "admin";
	}
	if (!isOwner && !isAdmin) error(403, "Not allowed to delete this recast");

	// Best-effort blob delete. Skip legacy/external absolute URLs (only
	// bare R2 keys are ours to remove). Archived rows may already be blobless
	// — a 404 from the provider is fine, so swallow errors and still drop the
	// row rather than stranding it.
	if (row.videoUrl && !/^https?:\/\//.test(row.videoUrl)) {
		await deleteObject(row.videoUrl).catch((err) => {
			console.error(`[recasts/delete] R2 delete failed for ${row.id}`, err);
		});
	}

	await db.transaction(async (tx) => {
		await tx.delete(recast).where(eq(recast.id, row.id));
		if (row.status === "published") {
			await decrementUsageOnDelete(row.workspaceId, row.sizeBytes, tx);
		} else if (row.status === "archived") {
			await tx
				.update(workspaceUsage)
				.set({
					archivedRecastsCount: sql`GREATEST(${workspaceUsage.archivedRecastsCount} - 1, 0)`,
					updatedAt: new Date(),
				})
				.where(eq(workspaceUsage.workspaceId, row.workspaceId));
		}
		// `draft` never bumped usage — nothing to reverse.
	});

	return json({ ok: true });
};
