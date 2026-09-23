ALTER TABLE "connection" DROP CONSTRAINT "connection_user_provider";--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "external_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "principal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "connection_user_provider_idx" ON "connection" USING btree ("user_id","provider");--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_provider_account" UNIQUE("user_id","provider","external_id");--> statement-breakpoint
-- Conexão que já existia era a única daquele provedor, logo é a principal.
-- Sem isto, toda escrita (mandar e-mail, criar evento) passaria a perguntar
-- "qual conta?" para quem só tem uma, que é o oposto do que a multi-conta é.
UPDATE "connection" SET "principal" = true WHERE "principal" = false;
