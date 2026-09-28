ALTER TABLE "wa_mensagem" ADD COLUMN "respondida_em" timestamp;
--> statement-breakpoint
-- o que já foi roteado antes desta coluna existir conta como respondido: retomar
-- pedidos antigos ao subir responderia de novo coisas já respondidas
UPDATE "wa_mensagem" SET "respondida_em" = "roteada_em" WHERE "roteada_em" IS NOT NULL;
