CREATE TABLE "biometric_face_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"sample_id" uuid,
	"backend" text NOT NULL,
	"dim" integer NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_face_sample" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"source" text NOT NULL,
	"image_enc" text,
	"mime" text,
	"face_size" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_unknown_face" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"backend" text NOT NULL,
	"vector" real[] NOT NULL,
	"source_ref" text,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "biometric_unknown_face_label" UNIQUE("user_id","label")
);
--> statement-breakpoint
CREATE TABLE "person_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"room_id" uuid,
	"source" text NOT NULL,
	"confidence" real,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_presence_person" UNIQUE("user_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "camera" ADD COLUMN "identify_faces" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "camera_event" ADD COLUMN "identified_person_id" uuid;--> statement-breakpoint
ALTER TABLE "camera_event" ADD COLUMN "identified_score" real;--> statement-breakpoint
ALTER TABLE "camera_event" ADD COLUMN "identified_outcome" text;--> statement-breakpoint
ALTER TABLE "camera_event" ADD COLUMN "identified_label" text;--> statement-breakpoint
ALTER TABLE "camera_event" ADD COLUMN "identified_at" timestamp;--> statement-breakpoint
ALTER TABLE "biometric_face_embedding" ADD CONSTRAINT "biometric_face_embedding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_face_embedding" ADD CONSTRAINT "biometric_face_embedding_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_face_embedding" ADD CONSTRAINT "biometric_face_embedding_sample_id_biometric_face_sample_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."biometric_face_sample"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_face_sample" ADD CONSTRAINT "biometric_face_sample_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_face_sample" ADD CONSTRAINT "biometric_face_sample_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_unknown_face" ADD CONSTRAINT "biometric_unknown_face_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_presence" ADD CONSTRAINT "person_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_presence" ADD CONSTRAINT "person_presence_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_presence" ADD CONSTRAINT "person_presence_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_face_embedding_person_backend_idx" ON "biometric_face_embedding" USING btree ("person_id","backend");--> statement-breakpoint
CREATE INDEX "biometric_face_sample_person_idx" ON "biometric_face_sample" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "biometric_unknown_face_expires_idx" ON "biometric_unknown_face" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "person_presence_seen_idx" ON "person_presence" USING btree ("seen_at");--> statement-breakpoint
ALTER TABLE "camera_event" ADD CONSTRAINT "camera_event_identified_person_id_person_id_fk" FOREIGN KEY ("identified_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;