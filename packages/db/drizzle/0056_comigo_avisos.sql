CREATE TABLE "comigo_aviso" (
	"user_id" text NOT NULL,
	"chave" text NOT NULL,
	"visto_em" timestamp DEFAULT now() NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comigo_aviso_user_id_chave_pk" PRIMARY KEY("user_id","chave")
);
--> statement-breakpoint
ALTER TABLE "comigo_aviso" ADD CONSTRAINT "comigo_aviso_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comigo_aviso_visto_idx" ON "comigo_aviso" USING btree ("user_id","visto_em");