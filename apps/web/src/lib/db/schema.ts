import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Tabela mínima para validar a esteira de migração (Fase 0). */
export const meta = pgTable("meta", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Meta = typeof meta.$inferSelect;
export type NewMeta = typeof meta.$inferInsert;
