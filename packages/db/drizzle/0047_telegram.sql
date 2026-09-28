CREATE TABLE "tg_bot" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token_enc" text NOT NULL,
	"bot_id" text NOT NULL,
	"username" text NOT NULL,
	"proximo_update" bigint DEFAULT 0 NOT NULL,
	"ultimo_erro" text,
	"ultimo_contato_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tg_contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"telegram_id" text NOT NULL,
	"nome" text,
	"username" text,
	"papel" text DEFAULT 'desconhecido' NOT NULL,
	"person_id" uuid,
	"vinculado_em" timestamp,
	"avisado_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tg_contato_user_telegram" UNIQUE("user_id","telegram_id")
);
--> statement-breakpoint
CREATE TABLE "tg_convite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"codigo_hash" text NOT NULL,
	"papel" text NOT NULL,
	"person_id" uuid,
	"expira_em" timestamp NOT NULL,
	"usado_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tg_convite_codigo_hash_unique" UNIQUE("codigo_hash")
);
--> statement-breakpoint
CREATE TABLE "tg_mensagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contato_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"do_bot" boolean DEFAULT false NOT NULL,
	"tipo" text NOT NULL,
	"texto" text,
	"transcricao" text,
	"file_id" text,
	"midia_caminho" text,
	"midia_mime" text,
	"em" timestamp NOT NULL,
	"roteada_em" timestamp,
	"respondida_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tg_mensagem_user_chat_msg" UNIQUE("user_id","chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "tg_bot" ADD CONSTRAINT "tg_bot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_contato" ADD CONSTRAINT "tg_contato_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_contato" ADD CONSTRAINT "tg_contato_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_convite" ADD CONSTRAINT "tg_convite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_convite" ADD CONSTRAINT "tg_convite_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_mensagem" ADD CONSTRAINT "tg_mensagem_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tg_mensagem" ADD CONSTRAINT "tg_mensagem_contato_id_tg_contato_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."tg_contato"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tg_mensagem_pendente_idx" ON "tg_mensagem" USING btree ("user_id","roteada_em");