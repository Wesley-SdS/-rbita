import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const expense = pgTable("expense", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category"),
  amountCents: integer("amount_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Expense = typeof expense.$inferSelect;
