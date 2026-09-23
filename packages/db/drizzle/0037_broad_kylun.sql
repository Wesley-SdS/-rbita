ALTER TABLE "todo" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "origem_tipo" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "origem_id" uuid;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "origem_titulo" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "origem_trecho" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "para_quem" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "todo_origem_idx" ON "todo" USING btree ("user_id","origem_id");