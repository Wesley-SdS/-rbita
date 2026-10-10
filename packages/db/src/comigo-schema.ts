import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * O que já foi avisado sobre o que está com o dono nos sistemas da Adalink
 * (`core/comigo/`). Uma linha por fato ("atividade:<id>", "dev-atrasado:<id>"):
 * a chave primária é o que impede o mesmo aviso duas vezes, e a linha é
 * gravada ANTES do aviso, então cair no meio deixa no pior caso um aviso por
 * dar, nunca um em dobro.
 *
 * `vistoEm` anda a cada volta em que o fato continua de pé; o que some da
 * lista para de andar e é podado depois.
 */
export const comigoAviso = pgTable("comigo_aviso", {
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  chave: text("chave").notNull(),
  vistoEm: timestamp("visto_em").defaultNow().notNull(),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.chave] }),
  index("comigo_aviso_visto_idx").on(t.userId, t.vistoEm),
]);

export type ComigoAviso = typeof comigoAviso.$inferSelect;
