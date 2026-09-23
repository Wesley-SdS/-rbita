import { index, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * Tarefa do dono.
 *
 * Começou como um to-do de uma linha só e cresceu para o que o dono pediu em
 * 22/09/2026: editar, anotar, datar e, principalmente, SABER DE ONDE VEIO. Uma
 * tarefa que nasce de uma reunião sem dizer qual reunião vira, duas semanas
 * depois, uma linha sem sentido que ninguém lembra por que escreveu.
 */
export const todo = pgTable("todo", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  done: boolean("done").notNull().default(false),
  dueDate: timestamp("due_date"),
  imageUrl: text("image_url"), // data URL da imagem anexa (opcional)
  /** Anotações livres: o detalhe que não cabe no título da tarefa. */
  notes: text("notes"),
  /**
   * De onde a tarefa veio: "reuniao", "documento", "chat" ou nulo (criada à mão).
   *
   * O id aponta para `document`, mas SEM chave estrangeira, e isso é
   * deliberado: apagar a gravação de uma reunião não pode apagar o
   * compromisso que você assumiu nela. Por isso o título fica copiado aqui,
   * e o vínculo degrada para texto em vez de virar um id órfão na tela.
   */
  origemTipo: text("origem_tipo"),
  origemId: uuid("origem_id"),
  origemTitulo: text("origem_titulo"),
  /** O trecho que gerou a tarefa: é o "por que eu fiquei de fazer isso". */
  origemTrecho: text("origem_trecho"),
  /** Para quem ficou de fazer. Texto livre porque nem todo mundo da reunião é pessoa cadastrada. */
  paraQuem: text("para_quem"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
(t) => [index("todo_user_idx").on(t.userId, t.createdAt), index("todo_origem_idx").on(t.userId, t.origemId)]);

export type Todo = typeof todo.$inferSelect;
