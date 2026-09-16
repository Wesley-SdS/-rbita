CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"assistant_name" text DEFAULT 'Órbita' NOT NULL,
	"user_name" text,
	"persona" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;