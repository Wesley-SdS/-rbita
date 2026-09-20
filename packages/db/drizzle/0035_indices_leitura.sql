-- ÍNDICES DE LEITURA
--
-- Chave estrangeira NÃO cria índice no Postgres. As tabelas do núcleo (as
-- anteriores à Fase 2) nunca ganharam um, então todo `where user_id = ?` era
-- varredura de tabela inteira. Com a base de uma casa isso não aparecia nas
-- medições, mas `message`, `chunk` e `document` crescem sem teto: o painel de
-- uso agrega `message` inteira, e a janela de histórico do chat lê essa tabela
-- em todo turno.
--
-- A coluna de ORDENAÇÃO entra junto no índice quando a consulta sempre ordena
-- pelo mesmo campo (`order by updated_at desc limit 50`): o Postgres percorre
-- o índice de trás para frente e não precisa ordenar nada.
--
-- Índice normal e não CONCURRENTLY: a migração roda dentro de uma transação, e
-- concurrently não pode. Travar estas tabelas por alguns milissegundos numa
-- casa é aceitável; num banco grande seria o contrário.
--
-- Tudo com IF NOT EXISTS porque a 0034 foi escrita à mão e o instantâneo do
-- drizzle-kit ficou para trás: sem isto, a linha de `destino` abaixo derrubaria
-- a migração em qualquer banco que já rodou a 0034.
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "destino" text;--> statement-breakpoint

-- chat: o caminho quente (janela de histórico) e a lista de conversas
CREATE INDEX IF NOT EXISTS "conversation_user_updated_idx" ON "conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_conversation_created_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint

-- acervo: contagem do painel, listagem e reindexação varrem por dono
CREATE INDEX IF NOT EXISTS "chunk_user_idx" ON "chunk" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_user_created_idx" ON "document" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_user_created_idx" ON "memory" USING btree ("user_id","created_at");--> statement-breakpoint

-- finanças: a tela e o cron de contas a vencer
CREATE INDEX IF NOT EXISTS "expense_user_created_idx" ON "expense" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_user_due_idx" ON "expense" USING btree ("user_id","due_date");--> statement-breakpoint

-- o que a tela consulta de tempos em tempos
CREATE INDEX IF NOT EXISTS "notification_user_created_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_user_idx" ON "routine" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todo_user_idx" ON "todo" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_queue_user_status_idx" ON "action_queue" USING btree ("user_id","status","created_at");--> statement-breakpoint

-- extensões e cards
CREATE INDEX IF NOT EXISTS "mcp_server_user_idx" ON "mcp_server" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_user_idx" ON "skill" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_user_position_idx" ON "widget" USING btree ("user_id","position","created_at");
