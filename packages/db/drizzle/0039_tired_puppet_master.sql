ALTER TABLE "document" ADD COLUMN "origem_tipo" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "origem_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "origem_titulo" text;--> statement-breakpoint
CREATE INDEX "document_user_origem_idx" ON "document" USING btree ("user_id","origem_id");