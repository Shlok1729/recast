import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { recast } from "./recasts";

/**
 * Workspace-scoped free-text label. Used for multi-select filter chips on
 * the library view. Tag names are case-insensitive on read but stored as
 * entered; the unique constraint is exact-match by design — let the UI
 * dedupe on lowercase before insert.
 */
export const tag = pgTable(
	"tag",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** Hex color or null for default. */
		color: text("color"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("tag_workspace_idx").on(t.workspaceId),
		unique("tag_workspace_name_key").on(t.workspaceId, t.name),
	],
);

export const recastTag = pgTable(
	"recast_tag",
	{
		recastId: text("recast_id")
			.notNull()
			.references(() => recast.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tag.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("recast_tag_tag_idx").on(t.tagId),
		unique("recast_tag_recast_tag_key").on(t.recastId, t.tagId),
	],
);

export type Tag = typeof tag.$inferSelect;
export type RecastTag = typeof recastTag.$inferSelect;
