CREATE TABLE "trabalho_conta" (
	"conexao_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"visto_ate" timestamp NOT NULL,
	"falhas" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trabalho_novidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conexao_id" uuid NOT NULL,
	"provedor" text NOT NULL,
	"evento_id" text NOT NULL,
	"tipo" text NOT NULL,
	"contexto" text NOT NULL,
	"autor" text DEFAULT '' NOT NULL,
	"estado" text,
	"trecho" text DEFAULT '' NOT NULL,
	"url" text,
	"quando" timestamp NOT NULL,
	"visto" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trabalho_conta" ADD CONSTRAINT "trabalho_conta_conexao_id_connection_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabalho_conta" ADD CONSTRAINT "trabalho_conta_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabalho_novidade" ADD CONSTRAINT "trabalho_novidade_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabalho_novidade" ADD CONSTRAINT "trabalho_novidade_conexao_id_connection_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trabalho_novidade_conexao_evento_uniq" ON "trabalho_novidade" USING btree ("conexao_id","evento_id");--> statement-breakpoint
CREATE INDEX "trabalho_novidade_user_quando_idx" ON "trabalho_novidade" USING btree ("user_id","quando");