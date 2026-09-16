CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"account_label" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"scope" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connection_user_provider" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;