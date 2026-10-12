CREATE TABLE "controle_passo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sessao_id" uuid,
	"acao_id" text,
	"tool" text NOT NULL,
	"acao" text,
	"alvo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risco" text NOT NULL,
	"decisao" text NOT NULL,
	"resultado" text,
	"duracao_ms" integer,
	"miniatura" text,
	"canal" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "controle_sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"alvo" text NOT NULL,
	"objetivo" text NOT NULL,
	"pedido_original" text NOT NULL,
	"pedido_literal" boolean DEFAULT true NOT NULL,
	"apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"teto_passos" integer NOT NULL,
	"passos_usados" integer DEFAULT 0 NOT NULL,
	"teto_minutos" integer NOT NULL,
	"expira_em" timestamp NOT NULL,
	"status" text DEFAULT 'ativa' NOT NULL,
	"motivo" text,
	"vetos_seguidos" integer DEFAULT 0 NOT NULL,
	"canal" text DEFAULT 'tela' NOT NULL,
	"maquina" text NOT NULL,
	"acao_id" text,
	"criada_em" timestamp DEFAULT now() NOT NULL,
	"atualizada_em" timestamp DEFAULT now() NOT NULL,
	"terminada_em" timestamp
);
--> statement-breakpoint
ALTER TABLE "controle_passo" ADD CONSTRAINT "controle_passo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controle_passo" ADD CONSTRAINT "controle_passo_sessao_id_controle_sessao_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."controle_sessao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controle_sessao" ADD CONSTRAINT "controle_sessao_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "controle_passo_user_quando" ON "controle_passo" USING btree ("user_id","criado_em");--> statement-breakpoint
CREATE INDEX "controle_passo_sessao" ON "controle_passo" USING btree ("sessao_id","criado_em");--> statement-breakpoint
CREATE INDEX "controle_passo_acao" ON "controle_passo" USING btree ("acao_id");--> statement-breakpoint
CREATE INDEX "controle_sessao_user_status" ON "controle_sessao" USING btree ("user_id","status","criada_em");--> statement-breakpoint
CREATE INDEX "controle_sessao_terminada" ON "controle_sessao" USING btree ("terminada_em");