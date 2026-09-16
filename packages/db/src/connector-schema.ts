import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Conexões OAuth com serviços externos (Gmail, Calendar, Notion, Slack…).
 * Independente do `account` do Better Auth (que é só login): aqui guardamos
 * tokens com escopos de conector, criptografados em repouso (ver lib/crypto.ts).
 */
export const connection = pgTable(
  "connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // "google" cobre Gmail+Calendar; "notion", "slack", "whatsapp".
    provider: text("provider").notNull(),
    // rótulo legível da conta conectada (e-mail, workspace…), quando disponível.
    accountLabel: text("account_label"),
    // tokens criptografados (AES-256-GCM) — nunca em texto puro.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("connection_user_provider").on(t.userId, t.provider)],
);

export type Connection = typeof connection.$inferSelect;
export type NewConnection = typeof connection.$inferInsert;
