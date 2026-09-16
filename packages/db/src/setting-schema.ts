import { pgTable, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";

/**
 * Configuração chave/valor tipada (princípio ZERO HARDCODE, CLAUDE.md §5.6).
 *
 * O CÓDIGO define cada chave com default sensato e faixa válida
 * (packages/core/src/settings/defs.ts); o BANCO guarda só o que o dono
 * sobrescreveu pela tela de ajustes. Linha ausente = default. Assim o app
 * sobe sem nenhuma configuração e nada obrigatório mora aqui.
 *
 * `scope` existe desde já para "pessoas da casa" e dispositivos (por cômodo):
 * "global" hoje; "user:<id>" e "device:<id>" quando as ondas 3/6 precisarem.
 * Não é multi-tenant: é o mesmo dono, com contexto diferente.
 */
export const setting = pgTable(
  "setting",
  {
    key: text("key").notNull(),
    scope: text("scope").notNull().default("global"),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.scope] })],
);

export type SettingRow = typeof setting.$inferSelect;
