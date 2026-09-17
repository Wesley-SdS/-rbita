CREATE TABLE "biometric_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"kinds" text[] NOT NULL,
	"granted_by" text NOT NULL,
	"guardian_person_id" uuid,
	"guardian_name" text,
	"term_version" text NOT NULL,
	"term_text" text NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "identity_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"person_id" uuid,
	"actor_person_id" uuid,
	"kind" text,
	"source" text,
	"confidence" real,
	"outcome" text,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_visibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_person_id" uuid NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_visibility_pair" UNIQUE("viewer_person_id","subject_person_id")
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "relation" text DEFAULT 'morador' NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "is_minor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "guardian_person_id" uuid;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "account_user_id" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "biometric_consent" ADD CONSTRAINT "biometric_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consent" ADD CONSTRAINT "biometric_consent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consent" ADD CONSTRAINT "biometric_consent_guardian_person_id_person_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_audit" ADD CONSTRAINT "identity_audit_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_visibility" ADD CONSTRAINT "person_visibility_viewer_person_id_person_id_fk" FOREIGN KEY ("viewer_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_visibility" ADD CONSTRAINT "person_visibility_subject_person_id_person_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biometric_consent_person_idx" ON "biometric_consent" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "identity_audit_user_created_idx" ON "identity_audit" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_audit_person_idx" ON "identity_audit" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_guardian_person_id_person_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_account_user_id_user_id_fk" FOREIGN KEY ("account_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;