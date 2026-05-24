CREATE TYPE "public"."share_visibility" AS ENUM('public', 'team', 'private');--> statement-breakpoint
CREATE TABLE "deviceCode" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "visibility" "share_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "deviceCode" ADD CONSTRAINT "deviceCode_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_code_device_code_idx" ON "deviceCode" USING btree ("device_code");--> statement-breakpoint
CREATE INDEX "device_code_user_code_idx" ON "deviceCode" USING btree ("user_code");--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_org_idx" ON "share" USING btree ("organization_id");