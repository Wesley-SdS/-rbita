CREATE TABLE "navegador_extensao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"token_hash" text NOT NULL,
	"versao" text,
	"criada_em" timestamp DEFAULT now() NOT NULL,
	"vista_em" timestamp,
	"revogada_em" timestamp
);
--> statement-breakpoint
CREATE TABLE "navegador_roteiro" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dominio" text NOT NULL,
	"intencao" text NOT NULL,
	"intencao_chave" text NOT NULL,
	"passos" jsonb NOT NULL,
	"tokens_aprendizado" integer DEFAULT 0 NOT NULL,
	"usos" integer DEFAULT 0 NOT NULL,
	"falhas" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"usado_em" timestamp
);
--> statement-breakpoint
CREATE TABLE "navegador_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"dominio" text NOT NULL,
	"modo" text NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "navegador_extensao" ADD CONSTRAINT "navegador_extensao_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navegador_roteiro" ADD CONSTRAINT "navegador_roteiro_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navegador_site" ADD CONSTRAINT "navegador_site_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "navegador_extensao_token" ON "navegador_extensao" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "navegador_extensao_user" ON "navegador_extensao" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "navegador_roteiro_chave" ON "navegador_roteiro" USING btree ("user_id","dominio","intencao_chave");--> statement-breakpoint
CREATE UNIQUE INDEX "navegador_site_user_dominio" ON "navegador_site" USING btree ("user_id","dominio");