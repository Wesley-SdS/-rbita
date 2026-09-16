import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Lançamento financeiro unificado (estilo OrbitFinance):
 * - kind="expense"    → gasto já realizado (paid=true)
 * - kind="payable"    → conta a pagar (paid=false até quitar; tem vencimento)
 * - kind="receivable" → conta a receber
 */
export const expense = pgTable("expense", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category"),
  amountCents: integer("amount_cents").notNull(),
  kind: text("kind", { enum: ["expense", "payable", "receivable"] }).notNull().default("expense"),
  dueDate: timestamp("due_date"),
  paid: boolean("paid").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Expense = typeof expense.$inferSelect;
