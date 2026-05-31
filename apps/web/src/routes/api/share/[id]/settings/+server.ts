import { error, json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { getAuth } from "$lib/auth/server";
import { getDb } from "$lib/db";
import { share, user } from "$lib/db/schema";
import type { RequestHandler } from "./$types";

type SessionShape = { user: { id: string; role?: string } };

const MAX_CTA_LABEL = 60;

/**
 * PATCH /api/share/[id]/settings
 *
 * Owner-or-admin endpoint for the non-visibility share knobs surfaced in the
 * share menu: the call-to-action button and the comments toggle. Visibility
 * lives in the sibling `/access` endpoint; password in `/unlock`.
 *
 * Body (all optional, only provided keys are written):
 *   - ctaLabel, ctaUrl : both-or-neither. Empty/null on either clears the
 *                        CTA. ctaUrl must be an absolute http(s) URL.
 *   - commentsEnabled  : boolean
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const session = (await getAuth()
		.api.getSession({ headers: request.headers })
		.catch(() => null)) as SessionShape | null;
	if (!session?.user) error(401, "Sign in required");

	let body: {
		ctaLabel?: unknown;
		ctaUrl?: unknown;
		commentsEnabled?: unknown;
	} = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, "Invalid JSON body");
	}

	const db = getDb();
	const [row] = await db
		.select({ ownerId: share.ownerId })
		.from(share)
		.where(eq(share.slug, params.id))
		.limit(1);
	if (!row) error(404, "Share not found");

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
	if (!isOwner && !isAdmin) error(403, "Not allowed to change this share");

	const patch: {
		ctaLabel?: string | null;
		ctaUrl?: string | null;
		commentsEnabled?: boolean;
	} = {};

	// CTA is both-or-neither: a label without a destination (or vice versa)
	// renders a dead button, so we treat a partial input as "clear".
	const hasCta = "ctaLabel" in body || "ctaUrl" in body;
	if (hasCta) {
		const label =
			typeof body.ctaLabel === "string" ? body.ctaLabel.trim().slice(0, MAX_CTA_LABEL) : "";
		const rawUrl = typeof body.ctaUrl === "string" ? body.ctaUrl.trim() : "";
		if (label && rawUrl) {
			let parsed: URL;
			try {
				parsed = new URL(rawUrl);
			} catch {
				error(400, "CTA link must be a valid URL");
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				error(400, "CTA link must be an http(s) URL");
			}
			patch.ctaLabel = label;
			patch.ctaUrl = parsed.toString();
		} else {
			patch.ctaLabel = null;
			patch.ctaUrl = null;
		}
	}

	if (typeof body.commentsEnabled === "boolean") {
		patch.commentsEnabled = body.commentsEnabled;
	}

	if (Object.keys(patch).length === 0) error(400, "Nothing to update");

	await db.update(share).set(patch).where(eq(share.slug, params.id));

	return json({ ok: true, ...patch });
};
