import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const routine = pgTable("routine", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(1440),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notification = pgTable("notification", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  routineId: uuid("routine_id").references(() => routine.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Routine = typeof routine.$inferSelect;
export type Notification = typeof notification.$inferSelect;
