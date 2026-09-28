ALTER TABLE "reuniao_importada" ADD COLUMN "tentativas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reuniao_importada" ADD COLUMN "ultimo_erro" text;--> statement-breakpoint
ALTER TABLE "reuniao_importada" ADD COLUMN "proxima_tentativa" timestamp;--> statement-breakpoint
ALTER TABLE "wa_mensagem" DROP COLUMN "respondida_em";--> statement-breakpoint
ALTER TABLE "tg_mensagem" DROP COLUMN "respondida_em";