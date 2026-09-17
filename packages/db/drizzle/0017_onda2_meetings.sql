CREATE TABLE "gmail_watch_state" (
	"user_id" text NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_watch_state_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_event_id" text NOT NULL,
	"reminded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_reminder_user_event" UNIQUE("user_id","calendar_event_id")
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "speakers" jsonb;--> statement-breakpoint
ALTER TABLE "gmail_watch_state" ADD CONSTRAINT "gmail_watch_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reminder" ADD CONSTRAINT "meeting_reminder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;