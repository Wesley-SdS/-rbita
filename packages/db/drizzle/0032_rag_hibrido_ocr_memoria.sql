-- Busca por palavra-chave em português (R2). A configuração NOMEADA é
-- obrigatória: `unaccent()` é STABLE, não IMMUTABLE, e chamada de função
-- STABLE não entra em coluna gerada nem em índice. Com a configuração, o
-- Postgres aceita, e "energia eletrica" passa a achar "energia elétrica".
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'portuguese_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION public.portuguese_unaccent ( COPY = pg_catalog.portuguese );
    ALTER TEXT SEARCH CONFIGURATION public.portuguese_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, portuguese_stem;
  END IF;
END
$$;--> statement-breakpoint
CREATE TABLE "memory_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid,
	"content" text NOT NULL,
	"evidence" text,
	"category" text DEFAULT 'geral' NOT NULL,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"reason" text DEFAULT 'confianca_baixa' NOT NULL,
	"similar_to" uuid,
	"memory_id" uuid,
	"embedding" vector(768) NOT NULL,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "char_start" integer;--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "char_end" integer;--> statement-breakpoint
ALTER TABLE "chunk" ADD COLUMN "fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('public.portuguese_unaccent'::regconfig, coalesce(content, ''))) STORED;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('public.portuguese_unaccent'::regconfig, coalesce(content, ''))) STORED;--> statement-breakpoint
ALTER TABLE "memory_candidate" ADD CONSTRAINT "memory_candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidate" ADD CONSTRAINT "memory_candidate_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidate" ADD CONSTRAINT "memory_candidate_similar_to_memory_id_fk" FOREIGN KEY ("similar_to") REFERENCES "public"."memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidate" ADD CONSTRAINT "memory_candidate_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_candidate_user_status_idx" ON "memory_candidate" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "memory_candidate_embedding_idx" ON "memory_candidate" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_fts_idx" ON "chunk" USING gin ("fts");--> statement-breakpoint
CREATE INDEX "chunk_document_idx" ON "chunk" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_user_file_hash_idx" ON "document" USING btree ("user_id","file_hash") WHERE "document"."file_hash" is not null;--> statement-breakpoint
CREATE INDEX "memory_fts_idx" ON "memory" USING gin ("fts");