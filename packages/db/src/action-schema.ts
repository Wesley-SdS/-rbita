import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Fila de ações com efeito colateral (enviar e-mail, criar evento, postar…).
 * As tools do LLM NUNCA executam essas ações — apenas enfileiram uma PROPOSTA
 * aqui. A execução só acontece quando o usuário aprova pela UI (endpoint
 * /api/actions confirm). Assim, um prompt-injection não consegue disparar o
 * efeito colateral, mesmo que engane o modelo. Gate humano estrutural.
 */
export const actionQueue = pgTable("action_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // enviar_email | criar_evento | enviar_slack | enviar_whatsapp
  summary: text("summary").notNull(), // descrição legível da proposta
  payload: jsonb("payload").notNull(), // argumentos da ação
  status: text("status", { enum: ["pending", "done", "cancelled", "failed"] }).notNull().default("pending"),
  result: text("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ActionQueue = typeof actionQueue.$inferSelect;
