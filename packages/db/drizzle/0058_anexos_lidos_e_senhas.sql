CREATE TABLE "anexo_lido" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conexao_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"mensagem_id" text NOT NULL,
	"anexo_id" text NOT NULL,
	"nome" text NOT NULL,
	"sha256" text NOT NULL,
	"tamanho" integer NOT NULL,
	"tipo" text NOT NULL,
	"familia" text NOT NULL,
	"texto" text NOT NULL,
	"resumo" text NOT NULL,
	"detalhes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lido_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anexo_senha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dominio" text NOT NULL,
	"rotulo" text,
	"senha_enc" text NOT NULL,
	"criada_em" timestamp DEFAULT now() NOT NULL,
	"usada_em" timestamp
);
--> statement-breakpoint
ALTER TABLE "anexo_lido" ADD CONSTRAINT "anexo_lido_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexo_lido" ADD CONSTRAINT "anexo_lido_conexao_id_connection_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexo_senha" ADD CONSTRAINT "anexo_senha_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anexo_lido_unico" ON "anexo_lido" USING btree ("user_id","conexao_id","mensagem_id","anexo_id");--> statement-breakpoint
CREATE INDEX "anexo_lido_hash" ON "anexo_lido" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "anexo_lido_quando" ON "anexo_lido" USING btree ("lido_em");--> statement-breakpoint
CREATE INDEX "anexo_senha_dominio" ON "anexo_senha" USING btree ("user_id","dominio");