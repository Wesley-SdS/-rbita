CREATE TABLE "pluggy_conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_ref" uuid NOT NULL,
	"pluggy_id" text NOT NULL,
	"tipo" text NOT NULL,
	"subtipo" text,
	"nome" text NOT NULL,
	"numero" text,
	"titular_documento" text,
	"saldo_banco" bigint,
	"saldo_banco_em" timestamp,
	"conta_id" uuid,
	"ativa" boolean DEFAULT true NOT NULL,
	"importada_em" timestamp,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pluggy_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"banco" text DEFAULT 'Banco' NOT NULL,
	"status" text,
	"execution_status" text,
	"atualizado_no_banco_em" timestamp,
	"sincronizado_em" timestamp,
	"erro" text,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pluggy_transacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conta_ref" uuid NOT NULL,
	"pluggy_id" text NOT NULL,
	"data" date NOT NULL,
	"natureza" text NOT NULL,
	"valor" bigint NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"lancamento_id" uuid,
	"estado" text DEFAULT 'lancada' NOT NULL,
	"terceiro" boolean DEFAULT false NOT NULL,
	"grupo_transferencia" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pluggy_conta" ADD CONSTRAINT "pluggy_conta_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pluggy_conta" ADD CONSTRAINT "pluggy_conta_item_ref_pluggy_item_id_fk" FOREIGN KEY ("item_ref") REFERENCES "public"."pluggy_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pluggy_item" ADD CONSTRAINT "pluggy_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pluggy_transacao" ADD CONSTRAINT "pluggy_transacao_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pluggy_transacao" ADD CONSTRAINT "pluggy_transacao_conta_ref_pluggy_conta_id_fk" FOREIGN KEY ("conta_ref") REFERENCES "public"."pluggy_conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pluggy_conta_user_pluggy_idx" ON "pluggy_conta" USING btree ("user_id","pluggy_id");--> statement-breakpoint
CREATE INDEX "pluggy_conta_item_idx" ON "pluggy_conta" USING btree ("item_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "pluggy_item_user_item_idx" ON "pluggy_item" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pluggy_transacao_user_pluggy_idx" ON "pluggy_transacao" USING btree ("user_id","pluggy_id");--> statement-breakpoint
CREATE INDEX "pluggy_transacao_user_data_idx" ON "pluggy_transacao" USING btree ("user_id","data");--> statement-breakpoint
CREATE INDEX "pluggy_transacao_conta_idx" ON "pluggy_transacao" USING btree ("conta_ref");