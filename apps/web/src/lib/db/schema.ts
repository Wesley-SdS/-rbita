import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Tabelas de autenticação (Better Auth).
export * from "./auth-schema";
// Tabelas de chat (conversas + mensagens).
export * from "./chat-schema";
// Tabelas de conhecimento (documentos + chunks + memória, com pgvector).
export * from "./knowledge-schema";

/** Tabela mínima para validar a esteira de migração (Fase 0). */
export const meta = pgTable("meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Meta = typeof meta.$inferSelect;
export type NewMeta = typeof meta.$inferInsert;
