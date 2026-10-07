CREATE TABLE "email_caixa" (
	"conexao_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"visto_ate" timestamp NOT NULL,
	"falhas" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_triado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conexao_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"mensagem_id" text NOT NULL,
	"de" text NOT NULL,
	"remetente" text DEFAULT '' NOT NULL,
	"assunto" text DEFAULT '' NOT NULL,
	"trecho" text DEFAULT '' NOT NULL,
	"recebido_em" timestamp NOT NULL,
	"categoria" text NOT NULL,
	"resumo" text,
	"classificado_por" text DEFAULT 'regra' NOT NULL,
	"o_que_fazer" text,
	"prazo" text,
	"tarefa_id" uuid,
	"movimentacao" jsonb,
	"lancamento" text,
	"lancamento_id" uuid,
	"autenticado" boolean DEFAULT false NOT NULL,
	"link" text,
	"resolvido" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_caixa" ADD CONSTRAINT "email_caixa_conexao_id_connection_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_caixa" ADD CONSTRAINT "email_caixa_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_triado" ADD CONSTRAINT "email_triado_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_triado" ADD CONSTRAINT "email_triado_conexao_id_connection_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_triado_conexao_msg_uniq" ON "email_triado" USING btree ("conexao_id","mensagem_id");--> statement-breakpoint
CREATE INDEX "email_triado_user_cat_idx" ON "email_triado" USING btree ("user_id","categoria","recebido_em");