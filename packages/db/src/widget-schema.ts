import { pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Widgets do dashboard: cards que o usuário (ou a Órbita, "pinando" da conversa)
 * cria para acompanhar algo no dia a dia. Tipos: cotação de moeda, clima de uma
 * cidade, nota livre, checklist. A `config` guarda os parâmetros (ex: moeda, cidade,
 * itens do checklist).
 */
export const widget = pgTable("widget", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["cotacao", "clima", "nota", "checklist"] }).notNull(),
  title: text("title").notNull(),
  config: jsonb("config").notNull().default({}),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Widget = typeof widget.$inferSelect;
