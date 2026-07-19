import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Tabelas de autenticação (Better Auth).
export * from "./auth-schema";
// Tabelas de chat (conversas + mensagens).
export * from "./chat-schema";
// Tabelas de conhecimento (documentos + chunks + memória, com pgvector).
export * from "./knowledge-schema";
// Tabelas de finanças (skill de gastos).
export * from "./finance-schema";
// Tabelas de rotinas + notificações (proatividade).
export * from "./routine-schema";
// Conexões OAuth com serviços externos (conectores).
export * from "./connector-schema";
// To-do list do dia a dia.
export * from "./todo-schema";
// Fila de ações destrutivas (gate humano — aprovação na UI).
export * from "./action-schema";
// Extensões: skills (comportamentos) + servidores MCP (ferramentas externas).
export * from "./extension-schema";
// Widgets do dashboard (cards pináveis: cotação, clima, nota, checklist).
export * from "./widget-schema";
// Perfil/persona configurável do usuário (personalização persistente).
export * from "./profile-schema";
// Inscrições Web Push (notificações do navegador).
export * from "./push-schema";

/** Tabela mínima para validar a esteira de migração (Fase 0). */
export const meta = pgTable("meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Meta = typeof meta.$inferSelect;
export type NewMeta = typeof meta.$inferInsert;
