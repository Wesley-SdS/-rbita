ALTER TABLE "todo" ADD COLUMN "lembrar_em" timestamp;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "lembrado_em" timestamp;--> statement-breakpoint
ALTER TABLE "wa_sessao" ADD COLUMN "ultimo_briefing" text;--> statement-breakpoint
CREATE INDEX "todo_lembrete_idx" ON "todo" USING btree ("lembrar_em") WHERE "todo"."lembrado_em" is null and "todo"."done" = false;