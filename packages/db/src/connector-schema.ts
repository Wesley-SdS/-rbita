import { pgTable, text, timestamp, uuid, unique, integer, boolean, index } from "drizzle-orm/pg-core";
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
    /**
     * Identificador ESTÁVEL da conta no provedor: o `sub` do id_token (Google,
     * Microsoft), o id do workspace (Slack, Notion), o cloudid (Jira).
     *
     * É o que permite ter duas contas do mesmo provedor. Antes a chave única
     * era (usuário, provedor), então conectar a segunda conta do Google
     * SUBSTITUÍA a primeira em silêncio, e o dono só descobria quando o e-mail
     * do trabalho sumia da busca.
     *
     * Vazio nas conexões que existiam antes desta coluna: elas continuam
     * valendo como a conta única daquele provedor, e ganham o id de verdade na
     * próxima reconexão.
     */
    externalId: text("external_id").notNull().default(""),
    /**
     * A conta que responde quando o pedido não diz qual. Leitura varre TODAS
     * as contas; escrita (mandar e-mail, criar evento) precisa de uma só, e
     * sem isto a Órbita teria de perguntar toda vez.
     */
    principal: boolean("principal").notNull().default(false),
    // tokens criptografados (AES-256-GCM) — nunca em texto puro.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at"),
    /**
     * Falhas seguidas de renovação em segundo plano (RV.4). Conexão revogada
     * gerava notificação a cada volta do laço até o dono desconectar na mão;
     * agora avisa uma vez e tenta de novo com espera crescente. Zera ao renovar
     * ou reconectar.
     */
    refreshFailures: integer("refresh_failures").notNull().default(0),
    refreshFailedAt: timestamp("refresh_failed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // a conta entra na chave: é o que permite dois Gmails, dois Outlooks, dois
    // workspaces de Jira no mesmo provedor
    unique("connection_user_provider_account").on(t.userId, t.provider, t.externalId),
    index("connection_user_provider_idx").on(t.userId, t.provider),
  ],
);

export type Connection = typeof connection.$inferSelect;
export type NewConnection = typeof connection.$inferInsert;
