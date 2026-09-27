CREATE TABLE "fin_atalho" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rotulo" text NOT NULL,
	"valor" bigint NOT NULL,
	"categoria_id" uuid,
	"conta_id" uuid,
	"cartao_id" uuid,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_cartao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"limite" bigint DEFAULT 0 NOT NULL,
	"fechamento" integer NOT NULL,
	"vencimento" integer NOT NULL,
	"conta_pagamento_id" uuid,
	"cor" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_categoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"cor" text NOT NULL,
	"orcamento" bigint DEFAULT 0 NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_compromisso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"direcao" text NOT NULL,
	"descricao" text NOT NULL,
	"valor" bigint NOT NULL,
	"vencimento" date NOT NULL,
	"categoria_id" uuid,
	"conta_id" uuid,
	"recorrencia" text DEFAULT 'nenhuma' NOT NULL,
	"serie_id" uuid,
	"dia_mes" integer,
	"status" text DEFAULT 'aberto' NOT NULL,
	"quitado_em" date,
	"lancamento_id" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" text DEFAULT 'corrente' NOT NULL,
	"saldo_inicial" bigint DEFAULT 0 NOT NULL,
	"cor" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_desfazer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"descricao" text NOT NULL,
	"lancamento_ids" uuid[] NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_divida" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" text DEFAULT 'emprestimo' NOT NULL,
	"saldo_inicial" bigint DEFAULT 0 NOT NULL,
	"juros_mes" real DEFAULT 0 NOT NULL,
	"parcela_mensal" bigint DEFAULT 0 NOT NULL,
	"conta_id" uuid,
	"cartao_id" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_divida_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"divida_id" uuid NOT NULL,
	"data" date NOT NULL,
	"valor" bigint NOT NULL,
	"juros" bigint DEFAULT 0 NOT NULL,
	"abatimento" bigint NOT NULL,
	"lancamento_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fin_divida_rolagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"divida_id" uuid NOT NULL,
	"data" date NOT NULL,
	"valor" bigint NOT NULL,
	"fechamento" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_lancamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tipo" text NOT NULL,
	"data" date NOT NULL,
	"valor" bigint NOT NULL,
	"descricao" text,
	"categoria_id" uuid,
	"conta_id" uuid,
	"cartao_id" uuid,
	"transferencia" boolean DEFAULT false NOT NULL,
	"grupo_transferencia" uuid,
	"fixo" boolean DEFAULT false NOT NULL,
	"estorno" boolean DEFAULT false NOT NULL,
	"grupo_parcela" uuid,
	"parcela_n" integer,
	"parcela_de" integer,
	"meta_id" uuid,
	"meta_item_id" uuid,
	"compromisso_id" uuid,
	"importado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"orcamento" bigint DEFAULT 0 NOT NULL,
	"cor" text NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_meta_foto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"dado" text NOT NULL,
	"bytes" integer NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_meta_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"meta_id" uuid NOT NULL,
	"grupo" text DEFAULT 'Sem grupo' NOT NULL,
	"nome" text NOT NULL,
	"valor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planejado' NOT NULL,
	"forma" text DEFAULT 'avista' NOT NULL,
	"parcelas" integer DEFAULT 1 NOT NULL,
	"primeiro_venc" date,
	"conta_id" uuid,
	"cartao_id" uuid,
	"obs" text,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_pagamento_fatura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cartao_id" uuid NOT NULL,
	"fechamento" date NOT NULL,
	"valor" bigint NOT NULL,
	"data" date NOT NULL,
	"lancamento_id" uuid,
	"rolado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_perfil" (
	"user_id" text PRIMARY KEY NOT NULL,
	"renda" bigint DEFAULT 0 NOT NULL,
	"teto" bigint DEFAULT 0 NOT NULL,
	"boas_vindas_vistas" boolean DEFAULT false NOT NULL,
	"legado_importado_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_regra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contem" text NOT NULL,
	"categoria_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_atalho" ADD CONSTRAINT "fin_atalho_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_cartao" ADD CONSTRAINT "fin_cartao_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_categoria" ADD CONSTRAINT "fin_categoria_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_compromisso" ADD CONSTRAINT "fin_compromisso_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_conta" ADD CONSTRAINT "fin_conta_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_desfazer" ADD CONSTRAINT "fin_desfazer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_divida" ADD CONSTRAINT "fin_divida_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_divida_pagamento" ADD CONSTRAINT "fin_divida_pagamento_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_divida_pagamento" ADD CONSTRAINT "fin_divida_pagamento_divida_id_fin_divida_id_fk" FOREIGN KEY ("divida_id") REFERENCES "public"."fin_divida"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_divida_rolagem" ADD CONSTRAINT "fin_divida_rolagem_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_divida_rolagem" ADD CONSTRAINT "fin_divida_rolagem_divida_id_fin_divida_id_fk" FOREIGN KEY ("divida_id") REFERENCES "public"."fin_divida"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_lancamento" ADD CONSTRAINT "fin_lancamento_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_meta" ADD CONSTRAINT "fin_meta_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_meta_foto" ADD CONSTRAINT "fin_meta_foto_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_meta_foto" ADD CONSTRAINT "fin_meta_foto_item_id_fin_meta_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."fin_meta_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_meta_item" ADD CONSTRAINT "fin_meta_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_meta_item" ADD CONSTRAINT "fin_meta_item_meta_id_fin_meta_id_fk" FOREIGN KEY ("meta_id") REFERENCES "public"."fin_meta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_pagamento_fatura" ADD CONSTRAINT "fin_pagamento_fatura_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_perfil" ADD CONSTRAINT "fin_perfil_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_regra" ADD CONSTRAINT "fin_regra_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_atalho_user_idx" ON "fin_atalho" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_cartao_user_idx" ON "fin_cartao" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_categoria_user_idx" ON "fin_categoria" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_compromisso_user_venc_idx" ON "fin_compromisso" USING btree ("user_id","vencimento");--> statement-breakpoint
CREATE INDEX "fin_compromisso_serie_idx" ON "fin_compromisso" USING btree ("serie_id");--> statement-breakpoint
CREATE INDEX "fin_conta_user_idx" ON "fin_conta" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_desfazer_user_idx" ON "fin_desfazer" USING btree ("user_id","criado_em");--> statement-breakpoint
CREATE INDEX "fin_divida_user_idx" ON "fin_divida" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_divida_pagamento_divida_idx" ON "fin_divida_pagamento" USING btree ("divida_id");--> statement-breakpoint
CREATE INDEX "fin_lancamento_user_data_idx" ON "fin_lancamento" USING btree ("user_id","data");--> statement-breakpoint
CREATE INDEX "fin_lancamento_grupo_idx" ON "fin_lancamento" USING btree ("grupo_parcela");--> statement-breakpoint
CREATE INDEX "fin_lancamento_meta_item_idx" ON "fin_lancamento" USING btree ("meta_item_id");--> statement-breakpoint
CREATE INDEX "fin_meta_user_idx" ON "fin_meta" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fin_meta_foto_item_idx" ON "fin_meta_foto" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "fin_meta_item_meta_idx" ON "fin_meta_item" USING btree ("meta_id");--> statement-breakpoint
CREATE INDEX "fin_pagamento_fatura_cartao_idx" ON "fin_pagamento_fatura" USING btree ("user_id","cartao_id");--> statement-breakpoint
CREATE INDEX "fin_regra_user_idx" ON "fin_regra" USING btree ("user_id");