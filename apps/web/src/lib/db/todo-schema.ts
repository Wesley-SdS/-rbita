import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/** To-do do dia a dia. Aceita uma imagem anexa (data URL) e texto extraído dela. */
export const todo = pgTable("todo", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  dueDate: timestamp("due_date"),
  imageUrl: text("image_url"), // data URL da imagem anexa (opcional)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Todo = typeof todo.$inferSelect;
