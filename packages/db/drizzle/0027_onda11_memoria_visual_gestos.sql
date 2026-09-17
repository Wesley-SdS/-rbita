CREATE TABLE "visual_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"camera_id" uuid,
	"room_id" uuid,
	"event_id" uuid,
	"score" real,
	"zone" text,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "camera" ADD COLUMN "detect_gestures" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visual_object" ADD CONSTRAINT "visual_object_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_object" ADD CONSTRAINT "visual_object_camera_id_camera_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."camera"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_object" ADD CONSTRAINT "visual_object_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_object" ADD CONSTRAINT "visual_object_event_id_camera_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."camera_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visual_object_user_label_idx" ON "visual_object" USING btree ("user_id","label");--> statement-breakpoint
CREATE INDEX "visual_object_expires_idx" ON "visual_object" USING btree ("expires_at");