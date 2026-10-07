import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { connection } from "./connector-schema";

/**
 * O que chegou para o dono nas ferramentas de trabalho: comentário e review
 * nas PRs dele (GitHub), pedido de review para ele, menção e mensagem direta
 * no Slack. O Jira é lido ao vivo (as pendências SÃO o estado atual); isto
 * aqui são EVENTOS, e cada um precisa ser avisado uma vez só, por isso a chave
 * única (conta, evento).
 *
 * Desconectar a conta apaga o que veio dela (cascade na conexão).
 */
export const trabalhoNovidade = pgTable("trabalho_novidade", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  conexaoId: uuid("conexao_id")
    .notNull()
    .references(() => connection.id, { onDelete: "cascade" }),
  /** "github" | "slack" */
  provedor: text("provedor").notNull(),
  /** id estável do evento no serviço ("review:123", "mencao:C1:1712.33") */
  eventoId: text("evento_id").notNull(),
  /** "review" | "comentario" | "pedido_review" | "mencao" | "mensagem_direta" */
  tipo: text("tipo").notNull(),
  /** a PR ("org/repo#42: Corrige o login") ou o canal ("#time-dev") */
  contexto: text("contexto").notNull(),
  autor: text("autor").notNull().default(""),
  /** APPROVED, CHANGES_REQUESTED, COMMENTED (review do GitHub) */
  estado: text("estado"),
  trecho: text("trecho").notNull().default(""),
  url: text("url"),
  quando: timestamp("quando").notNull(),
  /** o dono já viu (abriu ou dispensou): sai do destaque */
  visto: boolean("visto").notNull().default(false),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("trabalho_novidade_conexao_evento_uniq").on(t.conexaoId, t.eventoId),
  index("trabalho_novidade_user_quando_idx").on(t.userId, t.quando),
]);

/** Até onde cada conta já foi olhada (a mesma ideia do marcador das caixas de e-mail). */
export const trabalhoConta = pgTable("trabalho_conta", {
  conexaoId: uuid("conexao_id")
    .primaryKey()
    .references(() => connection.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  vistoAte: timestamp("visto_ate").notNull(),
  falhas: integer("falhas").notNull().default(0),
  atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
});

export type TrabalhoNovidade = typeof trabalhoNovidade.$inferSelect;
