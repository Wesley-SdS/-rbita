import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { connection } from "./connector-schema";

/**
 * Os e-mails do dono, já separados em AÇÃO, ÚTEIS e RUÍDO.
 *
 * Até aqui nada de e-mail ficava guardado: tudo era lido ao vivo, e não havia
 * onde lembrar que um e-mail pedia ação, que virou tarefa ou que a
 * movimentação dele já foi lançada. Uma linha por mensagem e por CONTA (o
 * dono conecta três Gmails e o Outlook): a chave única é o que faz a mesma
 * mensagem nunca ser triada, virar tarefa ou ser lançada duas vezes.
 *
 * Desconectar a conta apaga os e-mails dela (cascade na conexão): a Órbita
 * não guarda caixa de quem ela não pode mais ler.
 */
export const emailTriado = pgTable("email_triado", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  conexaoId: uuid("conexao_id")
    .notNull()
    .references(() => connection.id, { onDelete: "cascade" }),
  /** "google" | "microsoft" */
  provedor: text("provedor").notNull(),
  mensagemId: text("mensagem_id").notNull(),
  de: text("de").notNull(),
  /** o endereço sem o nome ("alertas@nubank.com.br"): é ele que diz se o banco é confiável */
  remetente: text("remetente").notNull().default(""),
  assunto: text("assunto").notNull().default(""),
  trecho: text("trecho").notNull().default(""),
  recebidoEm: timestamp("recebido_em").notNull(),
  /** "acao" | "util" | "ruido" */
  categoria: text("categoria").notNull(),
  /** uma frase de gente sobre o e-mail (o modelo escreve; sem ele, o trecho) */
  resumo: text("resumo"),
  /** quem decidiu a categoria: "modelo", "regra" (promoção, banco) ou "dono" (moveu na tela) */
  classificadoPor: text("classificado_por").notNull().default("regra"),
  /** o que o dono precisa fazer, quando é ação */
  oQueFazer: text("o_que_fazer"),
  prazo: text("prazo"),
  /** a tarefa criada a partir dele (sem FK: apagar a tarefa não apaga o e-mail) */
  tarefaId: uuid("tarefa_id"),
  /** o dinheiro do e-mail: { natureza, valor (centavos), contraparte } e, se for cobrança, o `vencimento` */
  movimentacao: jsonb("movimentacao").$type<{ natureza: "receita" | "despesa"; valor: number; contraparte: string | null; vencimento?: string } | null>(),
  /**
   * O efeito no financeiro: "lancado" (extrato), "quitado" (pagou conta em
   * aberto), "agendado" (virou conta a pagar ou a receber), "no_cartao" (fatura
   * de cartão já cadastrado), "repetido", "pendente" (esperando o dono) ou
   * "nada" (não é dinheiro). `lancamentoId` aponta o lançamento ou a conta.
   */
  lancamento: text("lancamento"),
  lancamentoId: uuid("lancamento_id"),
  /** o e-mail veio assinado pelo domínio do remetente (DKIM): sem isso, nada é lançado sozinho */
  autenticado: boolean("autenticado").notNull().default(false),
  /** link para abrir na caixa (Outlook dá; o do Gmail é montado com a conta) */
  link: text("link"),
  /** o dono resolveu ou dispensou: sai da aba */
  resolvido: boolean("resolvido").notNull().default(false),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("email_triado_conexao_msg_uniq").on(t.conexaoId, t.mensagemId),
  index("email_triado_user_cat_idx").on(t.userId, t.categoria, t.recebidoEm),
]);

/**
 * Até onde cada caixa já foi lida. Por CONTA: com um cursor só para o dono, a
 * caixa que recebeu por último empurrava o cursor e o e-mail mais antigo de
 * outra caixa, ainda não lido, ficava para trás (a vigia antiga era assim).
 */
export const emailCaixa = pgTable("email_caixa", {
  conexaoId: uuid("conexao_id")
    .primaryKey()
    .references(() => connection.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  vistoAte: timestamp("visto_ate").notNull(),
  /** voltas seguidas com erro: a tela diz "a conta X não está respondendo" */
  falhas: integer("falhas").notNull().default(0),
  atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
});

export type EmailTriado = typeof emailTriado.$inferSelect;
