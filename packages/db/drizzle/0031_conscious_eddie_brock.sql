ALTER TABLE "conversation" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "summary_count" integer DEFAULT 0 NOT NULL;