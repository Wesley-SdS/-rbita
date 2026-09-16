import { pgTable, text, timestamp, uuid, boolean, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Regras proativas: evento (ou horário) → condições → ações.
 *
 * É o que faz a Órbita agir sem ninguém perguntar. `routine` (intervalo + prompt)
 * continua existindo por paridade; a regra é a forma geral, e as ondas seguintes
 * (agenda, casa, câmeras) só acrescentam tipos de gatilho e de ação.
 *
 * Os três campos JSON são validados com zod no servidor (rules/engine.ts):
 *   trigger    { kind: "event", type: "finance.bill_due" } | { kind: "cron", expr: "0 8 * * *" }
 *   conditions [{ path: "payload.total", op: "gt", value: 100 }]
 *   actions    [{ kind: "notify", title: "...", body: "..." }, { kind: "prompt", prompt: "..." }]
 */
export const automationRule = pgTable("automation_rule", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").notNull(),
  conditions: jsonb("conditions").notNull().default([]),
  actions: jsonb("actions").notNull(),
  // regra criada pelo próprio sistema como padrão (o dono pode desligar/editar)
  builtinKey: text("builtin_key"),
  lastFiredAt: timestamp("last_fired_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AutomationRule = typeof automationRule.$inferSelect;
