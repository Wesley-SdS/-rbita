import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Onda 4 (canais): WhatsApp via Cloud API da Meta não tem OAuth por usuário
 * de verdade sem passar pela revisão de app da Meta (Embedded Signup) — fora
 * do alcance de configurar sozinho. O que DÁ para corrigir sem isso: tirar o
 * token/phone_id de env fixo (`.env`, exige redeploy) e trazer para cá, uma
 * tela editável, zero hardcode (CLAUDE.md §5.6). `WHATSAPP_TOKEN`/
 * `WHATSAPP_PHONE_ID` do `.env` viram só bootstrap, como `ALLOWED_EMAILS`.
 */
export const whatsappConnection = pgTable(
  "whatsapp_connection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    phoneId: text("phone_id").notNull(),
    tokenEnc: text("token_enc").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("whatsapp_connection_user").on(t.userId)],
);

export type WhatsappConnection = typeof whatsappConnection.$inferSelect;
