import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, jsonb, bigserial, index } from "drizzle-orm/pg-core";

/**
 * Trilha de eventos do assistente (event bus persistido).
 *
 * Tudo que acontece e pode disparar uma regra passa por aqui: rotina executada,
 * ação aprovada, conta a vencer, token renovado e, nas próximas ondas, evento do
 * Home Assistant, da agenda e das câmeras. É um OUTBOX: quem emite (Next ou
 * Nest) grava a linha; o processo persistente (apps/api) lê o que ainda não
 * processou e aciona as regras. Sem broker, sem fila externa: um Postgres só.
 */
export const eventLog = pgTable(
  "event_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(), // ex.: "routine.finished", "finance.bill_due"
    userId: text("user_id"), // null = evento do sistema (sem dono)
    source: text("source").notNull(), // "web" | "api" | "cron" | "ha" | ...
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Quando o apps/api despachou o evento para as regras (RV.5). O outbox é
     * lido por "ainda não processado", não por cursor de id: um cursor pula
     * evento gravado por outro processo com id menor que o último visto
     * (transação que comita depois) e reprocessa ou perde tudo num reboot.
     * Eventos do próprio apps/api nascem processados (despacho em processo).
     */
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    index("event_log_created_idx").on(t.createdAt),
    index("event_log_type_idx").on(t.type),
    index("event_log_user_idx").on(t.userId),
    index("event_log_pending_idx").on(t.id).where(sql`${t.processedAt} is null`),
  ],
);

export type EventLog = typeof eventLog.$inferSelect;
