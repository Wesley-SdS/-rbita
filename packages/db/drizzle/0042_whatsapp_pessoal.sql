CREATE TABLE "wa_contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"jid" text NOT NULL,
	"nome" text,
	"apelido" text,
	"grupo" boolean DEFAULT false NOT NULL,
	"modo" text DEFAULT 'aprovar' NOT NULL,
	"pausado_ate" timestamp,
	"escreveu_alguma_vez" boolean DEFAULT false NOT NULL,
	"ultima_mensagem_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_contato_user_jid" UNIQUE("user_id","jid")
);
--> statement-breakpoint
CREATE TABLE "wa_evento_bruto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"tipo" text NOT NULL,
	"external_id" text NOT NULL,
	"corpo" jsonb NOT NULL,
	"recebido_em" timestamp DEFAULT now() NOT NULL,
	"processado_em" timestamp,
	"falhas" integer DEFAULT 0 NOT NULL,
	"ultimo_erro" text,
	CONSTRAINT "wa_evento_bruto_chave" UNIQUE("device_id","tipo","external_id")
);
--> statement-breakpoint
CREATE TABLE "wa_mensagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contato_id" uuid NOT NULL,
	"chat_jid" text NOT NULL,
	"autor_jid" text,
	"autor_nome" text,
	"external_id" text,
	"de_mim" boolean DEFAULT false NOT NULL,
	"tipo" text NOT NULL,
	"texto" text,
	"transcricao" text,
	"descricao_imagem" text,
	"midia_caminho" text,
	"midia_sha256" text,
	"midia_mime" text,
	"responde_a" text,
	"reacao" text,
	"apagada" boolean DEFAULT false NOT NULL,
	"editada" boolean DEFAULT false NOT NULL,
	"enviada_pela_orbita" boolean DEFAULT false NOT NULL,
	"automatica" boolean DEFAULT false NOT NULL,
	"conteudo_hash" text,
	"lida_em" timestamp,
	"em" timestamp NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_mensagem_user_external" UNIQUE("user_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "wa_sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"webhook_segredo_enc" text NOT NULL,
	"jid" text,
	"status" text DEFAULT 'desconectado' NOT NULL,
	"pareado_em" timestamp,
	"reconexoes" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_sessao_user" UNIQUE("user_id"),
	CONSTRAINT "wa_sessao_device" UNIQUE("device_id")
);
--> statement-breakpoint
ALTER TABLE "action_queue" ADD COLUMN "canal" text DEFAULT 'tela' NOT NULL;--> statement-breakpoint
ALTER TABLE "action_queue" ADD COLUMN "expira_em" timestamp;--> statement-breakpoint
ALTER TABLE "wa_contato" ADD CONSTRAINT "wa_contato_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_evento_bruto" ADD CONSTRAINT "wa_evento_bruto_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_mensagem" ADD CONSTRAINT "wa_mensagem_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_mensagem" ADD CONSTRAINT "wa_mensagem_contato_id_wa_contato_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."wa_contato"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_sessao" ADD CONSTRAINT "wa_sessao_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_contato_user_ultima_idx" ON "wa_contato" USING btree ("user_id","ultima_mensagem_em");--> statement-breakpoint
CREATE INDEX "wa_evento_bruto_recebido_idx" ON "wa_evento_bruto" USING btree ("recebido_em");--> statement-breakpoint
CREATE INDEX "wa_mensagem_chat_em_idx" ON "wa_mensagem" USING btree ("user_id","chat_jid","em");--> statement-breakpoint
CREATE INDEX "wa_mensagem_user_em_idx" ON "wa_mensagem" USING btree ("user_id","em");