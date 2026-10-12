ALTER TABLE "pluggy_conta" ADD COLUMN "cartao_id" uuid;--> statement-breakpoint
ALTER TABLE "pluggy_conta" ADD COLUMN "limite" bigint;--> statement-breakpoint
ALTER TABLE "pluggy_conta" ADD COLUMN "dia_fechamento" integer;--> statement-breakpoint
ALTER TABLE "pluggy_conta" ADD COLUMN "dia_vencimento" integer;--> statement-breakpoint
ALTER TABLE "pluggy_item" ADD COLUMN "aviso_status" text;