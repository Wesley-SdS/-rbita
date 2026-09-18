import { pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const conversation = pgTable("conversation", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Nova conversa"),
  modelKey: text("model_key").notNull(),
  // RESUMO ACUMULADO da conversa (B4.2). Toda mensagem está sempre num de dois
  // lugares: na janela recente, que vai inteira para o modelo, ou aqui. Antes a
  // mensagem que saía da janela de histórico sumia para sempre.
  summary: text("summary"),
  /**
   * Quantas mensagens (na ordem createdAt, id) já estão dentro do resumo.
   * Contagem e não horário de corte: duas mensagens no mesmo milissegundo
   * cairiam no vão entre o resumo e a janela.
   */
  summaryCount: integer("summary_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const message = pgTable("message", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  modelKey: text("model_key"),
  tokens: integer("tokens"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;
