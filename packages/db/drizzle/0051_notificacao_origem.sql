ALTER TABLE "notification" ADD COLUMN "origem" text DEFAULT 'sistema' NOT NULL;--> statement-breakpoint
-- o que já existe: aviso com rotina é da rotina; aviso cujo título é o nome de
-- uma regra criada pelo dono (a ação "prompt" usa o nome da regra) é da regra
UPDATE "notification" SET "origem" = 'rotina' WHERE "routine_id" IS NOT NULL;--> statement-breakpoint
UPDATE "notification" n SET "origem" = 'regra'
  WHERE n."routine_id" IS NULL
    AND EXISTS (SELECT 1 FROM "automation_rule" r WHERE r."user_id" = n."user_id" AND r."builtin_key" IS NULL AND r."name" = n."title");
