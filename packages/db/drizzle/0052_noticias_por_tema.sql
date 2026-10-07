CREATE TABLE "noticia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tema_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"url" text NOT NULL,
	"site" text NOT NULL,
	"resumo" text,
	"encontrada_em" timestamp DEFAULT now() NOT NULL,
	"lida" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "noticia_tema" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tema" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_dia" text,
	"ultima_busca_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "noticia" ADD CONSTRAINT "noticia_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noticia" ADD CONSTRAINT "noticia_tema_id_noticia_tema_id_fk" FOREIGN KEY ("tema_id") REFERENCES "public"."noticia_tema"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noticia_tema" ADD CONSTRAINT "noticia_tema_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "noticia_user_url_uniq" ON "noticia" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "noticia_user_encontrada_idx" ON "noticia" USING btree ("user_id","encontrada_em");--> statement-breakpoint
CREATE INDEX "noticia_tema_user_idx" ON "noticia_tema" USING btree ("user_id");