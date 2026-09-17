import { pgTable, text, timestamp, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

/**
 * DONO desta instância (RV.1). Não é multi-tenant (CLAUDE.md §1): é quem pode
 * mudar o que vale para a casa inteira (ajustes globais, catálogo de tools,
 * lista de e-mails e, na Fase 2, limiares biométricos). As outras contas da
 * lista de autorizados continuam usando a Órbita, só não mudam isso.
 *
 * Decisão do dono (17/09): dono EXPLÍCITO, não deduzido. Uma linha só (id = 1).
 * Nasce com o primeiro usuário na primeira checagem; depois, só o próprio dono
 * transfere. Se a conta do dono for apagada, `user_id` vira null e NINGUÉM é
 * promovido sozinho: a posse volta só por `ORBITA_OWNER_EMAIL` no ambiente,
 * que exige acesso à máquina.
 */
export const instanceOwner = pgTable(
  "instance_owner",
  {
    id: integer("id").primaryKey().default(1),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [check("instance_owner_singleton", sql`${t.id} = 1`)],
);

export type InstanceOwner = typeof instanceOwner.$inferSelect;
