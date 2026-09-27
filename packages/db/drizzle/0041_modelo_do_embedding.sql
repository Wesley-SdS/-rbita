ALTER TABLE "chunk" ADD COLUMN "embed_model" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "embed_model" text;--> statement-breakpoint
ALTER TABLE "memory_candidate" ADD COLUMN "embed_model" text;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "embed_model" text;--> statement-breakpoint
ALTER TABLE "ha_entity" ADD COLUMN "embed_model" text;