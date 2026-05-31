import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";
import { recast } from "./recasts";

/**
 * Who can open a share link (Google-Docs-style scope):
 *   - `private`   → owner + workspace admins only
 *   - `workspace` → any signed-in member of `organizationId`
 *   - `selected`  → owner + addresses listed in `share_member`
 *   - `public`    → anyone with the URL
 *
 * `team` is kept as an alias for `workspace` to not break older rows /
 * loaders — new code should write `workspace`.
 *
 * Password is orthogonal — applies on top of any visibility above `private`.
 */
export const shareVisibilityEnum = pgEnum("share_visibility", [
	"private",
	"workspace",
	"team",
	"selected",
	"public",
]);

export const shareMemberRoleEnum = pgEnum("share_member_role", [
	"viewer",
	"commenter",
]);

export const share = pgTable(
	"share",
	{
		slug: text("slug").primaryKey(),
		recastId: text("recast_id")
			.notNull()
			.references(() => recast.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Required for `workspace`/`team` visibility, optional otherwise. */
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "set null",
		}),
		visibility: shareVisibilityEnum("visibility").notNull().default("public"),
		passwordHash: text("password_hash"),
		expiresAt: timestamp("expires_at"),
		/** Free plan: always true and shown on player. Pro removes. */
		watermark: boolean("watermark").notNull().default(true),
		/** Cached counter — incremented from share_view writes for cheap reads. */
		viewsCount: integer("views_count").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("share_owner_idx").on(t.ownerId),
		index("share_recast_idx").on(t.recastId),
		index("share_org_idx").on(t.organizationId),
	],
);

/**
 * Per-share allowlist for `visibility = 'selected'`. Supports inviting either
 * an existing user (resolved `userId`) or any email (signs in via magic link
 * on first view). Email is always present so removal-by-email works even
 * after the user signs up.
 */
export const shareMember = pgTable(
	"share_member",
	{
		id: text("id").primaryKey(),
		shareSlug: text("share_slug")
			.notNull()
			.references(() => share.slug, { onDelete: "cascade" }),
		email: text("email").notNull(),
		/** Resolved on invite if the email already maps to a user. */
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		role: shareMemberRoleEnum("role").notNull().default("viewer"),
		invitedBy: text("invited_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("share_member_share_idx").on(t.shareSlug),
		index("share_member_user_idx").on(t.userId),
		unique("share_member_share_email_key").on(t.shareSlug, t.email),
	],
);

/**
 * Append-only event log. Hot for writes, dense over time. Kept in the same
 * Postgres for v1; partition by created_at month or move to ClickHouse if
 * it grows past tens of millions of rows.
 */
export const shareView = pgTable(
	"share_view",
	{
		id: text("id").primaryKey(),
		shareId: text("share_id")
			.notNull()
			.references(() => share.slug, { onDelete: "cascade" }),
		/** Anonymous fingerprint — not tied to user.id (viewers don't need accounts). */
		sessionId: text("session_id").notNull(),
		country: text("country"),
		userAgent: text("user_agent"),
		watchPct: integer("watch_pct").notNull().default(0),
		completed: boolean("completed").notNull().default(false),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("share_view_share_idx").on(t.shareId),
		index("share_view_created_idx").on(t.createdAt),
	],
);

export type Share = typeof share.$inferSelect;
export type ShareMember = typeof shareMember.$inferSelect;
export type ShareView = typeof shareView.$inferSelect;
