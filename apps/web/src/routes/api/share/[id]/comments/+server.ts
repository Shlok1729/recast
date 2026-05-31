import { error, json } from "@sveltejs/kit";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "$lib/db";
import { shareComment, shareReaction } from "$lib/db/schema";
import { gateShareAccess } from "$lib/share/gate";
import type { RequestHandler } from "./$types";

const MAX_NAME = 60;
const MAX_BODY = 2000;

/**
 * GET /api/share/[id]/comments
 *
 * Public (subject to the share's visibility/password gate). Returns the
 * comment thread plus aggregated reactions for the share. Pass `?sessionId=`
 * — the anonymous browser fingerprint — so the response can flag which
 * comments/reactions belong to the caller (drives self-delete + toggle UI)
 * without ever leaking other viewers' fingerprints.
 */
export const GET: RequestHandler = async ({ params, request, cookies, url }) => {
	const gate = await gateShareAccess(params.id, request, cookies);
	const sessionId = url.searchParams.get("sessionId") ?? "";

	const db = getDb();

	const rows = await db
		.select({
			id: shareComment.id,
			sessionId: shareComment.sessionId,
			authorName: shareComment.authorName,
			atSeconds: shareComment.atSeconds,
			body: shareComment.body,
			createdAt: shareComment.createdAt,
		})
		.from(shareComment)
		.where(
			and(eq(shareComment.shareSlug, params.id), isNull(shareComment.deletedAt)),
		)
		.orderBy(asc(shareComment.createdAt));

	const reactionRows = await db
		.select({
			emoji: shareReaction.emoji,
			sessionId: shareReaction.sessionId,
		})
		.from(shareReaction)
		.where(eq(shareReaction.shareSlug, params.id));

	// Aggregate reactions per emoji → count, and collect the caller's own
	// emojis so the client can render the pressed state.
	const counts = new Map<string, number>();
	const mine: string[] = [];
	for (const r of reactionRows) {
		counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
		if (sessionId && r.sessionId === sessionId) mine.push(r.emoji);
	}

	return json({
		ok: true,
		commentsEnabled: gate.commentsEnabled,
		canManage: gate.canManage,
		comments: rows.map((c) => ({
			id: c.id,
			authorName: c.authorName,
			atSeconds: c.atSeconds,
			body: c.body,
			createdAt: c.createdAt.getTime(),
			mine: Boolean(sessionId) && c.sessionId === sessionId,
		})),
		reactions: [...counts.entries()].map(([emoji, count]) => ({ emoji, count })),
		myReactions: mine,
	});
};

/**
 * POST /api/share/[id]/comments
 *
 * Create a comment. Name-only identity — no account required; the viewer
 * supplies a display name and their anonymous `sessionId`. Refused when the
 * owner has disabled comments on this share (reactions stay open via the
 * sibling endpoint).
 *
 * Body: { sessionId, authorName, atSeconds, body }
 */
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const gate = await gateShareAccess(params.id, request, cookies);
	if (!gate.commentsEnabled) error(403, "Comments are turned off for this share");

	let body: {
		sessionId?: unknown;
		authorName?: unknown;
		atSeconds?: unknown;
		body?: unknown;
	} = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, "Invalid JSON body");
	}

	const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
	const authorName =
		typeof body.authorName === "string" ? body.authorName.trim().slice(0, MAX_NAME) : "";
	const text = typeof body.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
	const atSeconds =
		typeof body.atSeconds === "number" && Number.isFinite(body.atSeconds)
			? Math.max(0, Math.floor(body.atSeconds))
			: 0;

	if (!sessionId) error(400, "Missing session");
	if (!authorName) error(400, "A name is required");
	if (!text) error(400, "Comment can't be empty");

	const db = getDb();
	const id = crypto.randomUUID();
	const createdAt = new Date();

	await db.insert(shareComment).values({
		id,
		shareSlug: params.id,
		sessionId,
		authorName,
		atSeconds,
		body: text,
		createdAt,
	});

	return json(
		{
			ok: true,
			comment: {
				id,
				authorName,
				atSeconds,
				body: text,
				createdAt: createdAt.getTime(),
				mine: true,
			},
		},
		{ status: 201 },
	);
};
