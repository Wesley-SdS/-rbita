CREATE TABLE "camera" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"room_id" uuid,
	"provider" text DEFAULT 'generic' NOT NULL,
	"webhook_token" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camera_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "camera_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"camera_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"zone" text,
	"score" real,
	"snapshot" text,
	"narration" text,
	"narrated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "camera" ADD CONSTRAINT "camera_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camera" ADD CONSTRAINT "camera_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camera_event" ADD CONSTRAINT "camera_event_camera_id_camera_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."camera"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camera_event" ADD CONSTRAINT "camera_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "camera_event_camera_created_idx" ON "camera_event" USING btree ("camera_id","created_at");--> statement-breakpoint
CREATE INDEX "camera_event_created_idx" ON "camera_event" USING btree ("created_at");