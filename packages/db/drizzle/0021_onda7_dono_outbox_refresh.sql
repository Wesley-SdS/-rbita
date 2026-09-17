CREATE TABLE "instance_owner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"user_id" text,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_owner_singleton" CHECK ("instance_owner"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "refresh_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "refresh_failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "processed_at" timestamp;--> statement-breakpoint
-- eventos anteriores ao outbox por processed_at já foram tratados pelo cursor antigo: não reprocessar
UPDATE "event_log" SET "processed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "instance_owner" ADD CONSTRAINT "instance_owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_log_user_idx" ON "event_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_log_pending_idx" ON "event_log" USING btree ("id") WHERE "event_log"."processed_at" is null;