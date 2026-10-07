import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Notícias sobre os temas que o dono escolheu ("o que saiu hoje sobre IA na
 * saúde"). Todo dia a Órbita percorre a web por tema e guarda o que achou de
 * novo; a tela inicial mostra, e o chat, a voz e o WhatsApp leem daqui.
 *
 * Os dois cascades levam tudo junto: apagar a conta apaga temas e notícias, e
 * deixar de seguir um tema apaga as notícias dele (não é arquivo, é feed).
 */
export const noticiaTema = pgTable("noticia_tema", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  tema: text("tema").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  /** o dia ("AAAA-MM-DD", no fuso da casa) da última busca diária: uma por dia */
  ultimoDia: text("ultimo_dia"),
  ultimaBuscaEm: timestamp("ultima_busca_em"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("noticia_tema_user_idx").on(t.userId)]);

export const noticia = pgTable("noticia", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  temaId: uuid("tema_id")
    .notNull()
    .references(() => noticiaTema.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  url: text("url").notNull(),
  /** "g1.globo.com": quem conta a notícia */
  site: text("site").notNull(),
  /** uma ou duas frases sobre o que diz; o trecho da busca quando o modelo falha */
  resumo: text("resumo"),
  encontradaEm: timestamp("encontrada_em").defaultNow().notNull(),
  lida: boolean("lida").notNull().default(false),
}, (t) => [
  // a mesma matéria não volta amanhã nem por outro tema
  uniqueIndex("noticia_user_url_uniq").on(t.userId, t.url),
  index("noticia_user_encontrada_idx").on(t.userId, t.encontradaEm),
]);

export type NoticiaTema = typeof noticiaTema.$inferSelect;
export type Noticia = typeof noticia.$inferSelect;
