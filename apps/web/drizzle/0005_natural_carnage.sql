CREATE TABLE "share_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"share_slug" text NOT NULL,
	"session_id" text NOT NULL,
	"author_name" text NOT NULL,
	"at_seconds" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "share_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"share_slug" text NOT NULL,
	"session_id" text NOT NULL,
	"emoji" text NOT NULL,
	"at_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_reaction_unique_key" UNIQUE("share_slug","session_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "cta_label" text;--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "cta_url" text;--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "share_comment" ADD CONSTRAINT "share_comment_share_slug_share_slug_fk" FOREIGN KEY ("share_slug") REFERENCES "public"."share"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_reaction" ADD CONSTRAINT "share_reaction_share_slug_share_slug_fk" FOREIGN KEY ("share_slug") REFERENCES "public"."share"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_comment_share_idx" ON "share_comment" USING btree ("share_slug");--> statement-breakpoint
CREATE INDEX "share_comment_share_created_idx" ON "share_comment" USING btree ("share_slug","created_at");--> statement-breakpoint
CREATE INDEX "share_reaction_share_idx" ON "share_reaction" USING btree ("share_slug");