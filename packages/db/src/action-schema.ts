import { index, pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
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
  /**
   * De onde a proposta nasceu (PRD-WHATSAPP W6). A aprovação sem tela (dizer
   * "manda" na conversa "Eu" ou por voz) só vale para proposta do MESMO canal:
   * um "manda" no WhatsApp não aprova o que foi pedido no chat do app.
   */
  canal: text("canal", { enum: ["tela", "whatsapp", "voz"] }).notNull().default("tela"),
  /** depois disto, aprovar por frase não vale mais (só pela tela) */
  expiraEm: timestamp("expira_em"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
// a fila de aprovação abre em "o que está pendente meu", nessa ordem
(t) => [index("action_queue_user_status_idx").on(t.userId, t.status, t.createdAt)]);

export type ActionQueue = typeof actionQueue.$inferSelect;
