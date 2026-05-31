CREATE TYPE "public"."folder_permission_role" AS ENUM('viewer', 'editor', 'admin', 'no_access');--> statement-breakpoint
CREATE TYPE "public"."recast_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."share_member_role" AS ENUM('viewer', 'commenter');--> statement-breakpoint
CREATE TABLE "folder" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"color" text,
	"path" text DEFAULT '/' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "folder_parent_name_key" UNIQUE("workspace_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "folder_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"member_id" text NOT NULL,
	"role" "folder_permission_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "folder_permission_folder_member_key" UNIQUE("folder_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "share_member" (
	"id" text PRIMARY KEY NOT NULL,
	"share_slug" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"role" "share_member_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_member_share_email_key" UNIQUE("share_slug","email")
);
--> statement-breakpoint
CREATE TABLE "recast_tag" (
	"recast_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recast_tag_recast_tag_key" UNIQUE("recast_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tag_workspace_name_key" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "workspace_usage" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"active_recasts_count" integer DEFAULT 0 NOT NULL,
	"archived_recasts_count" integer DEFAULT 0 NOT NULL,
	"members_count" integer DEFAULT 1 NOT NULL,
	"views_last_30d" integer DEFAULT 0 NOT NULL,
	"last_recalculated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "visibility" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "visibility" SET DEFAULT 'public'::text;--> statement-breakpoint
DROP TYPE "public"."share_visibility";--> statement-breakpoint
CREATE TYPE "public"."share_visibility" AS ENUM('private', 'workspace', 'team', 'selected', 'public');--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "visibility" SET DEFAULT 'public'::"public"."share_visibility";--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "visibility" SET DATA TYPE "public"."share_visibility" USING "visibility"::"public"."share_visibility";--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "fps" integer;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "status" "recast_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "last_viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recast" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_permission" ADD CONSTRAINT "folder_permission_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_permission" ADD CONSTRAINT "folder_permission_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_member" ADD CONSTRAINT "share_member_share_slug_share_slug_fk" FOREIGN KEY ("share_slug") REFERENCES "public"."share"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_member" ADD CONSTRAINT "share_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_member" ADD CONSTRAINT "share_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recast_tag" ADD CONSTRAINT "recast_tag_recast_id_recast_id_fk" FOREIGN KEY ("recast_id") REFERENCES "public"."recast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recast_tag" ADD CONSTRAINT "recast_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_workspace_idx" ON "folder" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "folder_workspace_parent_idx" ON "folder" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "folder_workspace_path_idx" ON "folder" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "folder_permission_folder_idx" ON "folder_permission" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folder_permission_member_idx" ON "folder_permission" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "share_member_share_idx" ON "share_member" USING btree ("share_slug");--> statement-breakpoint
CREATE INDEX "share_member_user_idx" ON "share_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recast_tag_tag_idx" ON "recast_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_workspace_idx" ON "tag" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_usage_storage_idx" ON "workspace_usage" USING btree ("storage_bytes");--> statement-breakpoint
ALTER TABLE "recast" ADD CONSTRAINT "recast_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recast" ADD CONSTRAINT "recast_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recast_workspace_idx" ON "recast" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "recast_workspace_folder_idx" ON "recast" USING btree ("workspace_id","folder_id");--> statement-breakpoint
CREATE INDEX "recast_workspace_status_idx" ON "recast" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "recast_status_last_viewed_idx" ON "recast" USING btree ("status","last_viewed_at");