import { index, pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
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
},
/* Índices de leitura. Chave estrangeira NÃO cria índice no Postgres, então
   todo `where user_id = ?` destas tabelas era varredura de tabela inteira.
   Não doía com a base pequena; `message` e `document` crescem sem teto. */
(t) => [
  // a lista de conversas é `where user_id order by updated_at desc limit 50`;
  // a coluna de ordenação entra no índice para o banco não ordenar tudo antes
  index("conversation_user_updated_idx").on(t.userId, t.updatedAt),
]);

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
},
(t) => [
  // toda mensagem do chat carrega a janela de histórico por aqui, e o painel
  // de uso agrega esta tabela inteira: é a que mais cresce no banco
  index("message_conversation_created_idx").on(t.conversationId, t.createdAt),
]);

export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;
