CREATE TABLE "biometric_unknown_voice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"source_ref" text,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_voice_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"sample_id" uuid,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_voice_sample" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"source" text NOT NULL,
	"audio_enc" text,
	"mime" text,
	"duration_s" real,
	"speech_s" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biometric_unknown_voice" ADD CONSTRAINT "biometric_unknown_voice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_voice_embedding" ADD CONSTRAINT "biometric_voice_embedding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_voice_embedding" ADD CONSTRAINT "biometric_voice_embedding_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_voice_embedding" ADD CONSTRAINT "biometric_voice_embedding_sample_id_biometric_voice_sample_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."biometric_voice_sample"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_voice_sample" ADD CONSTRAINT "biometric_voice_sample_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_voice_sample" ADD CONSTRAINT "biometric_voice_sample_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_unknown_voice_expires_idx" ON "biometric_unknown_voice" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "biometric_voice_embedding_person_model_idx" ON "biometric_voice_embedding" USING btree ("person_id","model");--> statement-breakpoint
CREATE INDEX "biometric_voice_sample_person_idx" ON "biometric_voice_sample" USING btree ("person_id");