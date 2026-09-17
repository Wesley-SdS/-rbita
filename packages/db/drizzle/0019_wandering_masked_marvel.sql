CREATE TABLE "whatsapp_connection" (
	"user_id" text NOT NULL,
	"phone_id" text NOT NULL,
	"token_enc" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connection_user" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connection" ADD CONSTRAINT "whatsapp_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;