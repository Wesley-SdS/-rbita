CREATE TABLE "todo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"due_date" timestamp,
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "kind" text DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "due_date" timestamp;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "paid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "todo" ADD CONSTRAINT "todo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;