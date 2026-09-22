CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fluxo" text NOT NULL,
	"referencia" text,
	"provider" text NOT NULL,
	"modelo" text NOT NULL,
	"unidade" text NOT NULL,
	"entrada" integer DEFAULT 0 NOT NULL,
	"saida" integer DEFAULT 0 NOT NULL,
	"entrada_cache" integer DEFAULT 0 NOT NULL,
	"custo_usd" real DEFAULT 0 NOT NULL,
	"cobranca" text DEFAULT 'uso' NOT NULL,
	"duracao_ms" integer,
	"erro" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_event_user_created" ON "usage_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_event_fluxo" ON "usage_event" USING btree ("user_id","fluxo");