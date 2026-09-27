import { index, pgTable, text, timestamp, uuid, integer, boolean, bigint, date, real } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * LEGADO. O financeiro de uma tabela só (gasto, a pagar e a receber como
 * "kind"). Continua aqui só para a primeira abertura do financeiro novo
 * copiar o que o dono já tinha lançado (`finance/inicio.ts`); nada novo
 * escreve nela. Sai numa migração depois que todas as contas tiverem sido
 * copiadas.
 */
export const expense = pgTable("expense", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category"),
  amountCents: integer("amount_cents").notNull(),
  kind: text("kind", { enum: ["expense", "payable", "receivable"] }).notNull().default("expense"),
  dueDate: timestamp("due_date"),
  paid: boolean("paid").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(t) => [
  index("expense_user_created_idx").on(t.userId, t.createdAt),
  index("expense_user_due_idx").on(t.userId, t.dueDate),
]);

export type Expense = typeof expense.$inferSelect;

/*
 * FINANCEIRO (PRD "Freio de Mão", set/2026).
 *
 * Convenções que valem para todas as tabelas abaixo:
 *
 * - Dinheiro em CENTAVOS como bigint (modo number). `integer` para em
 *   21 milhões de reais, e uma meta de compra de imóvel soma perto disso.
 * - Datas de negócio são `date` em texto "YYYY-MM-DD": fatura, vencimento e
 *   parcela são DIAS, não instantes, e um timestamp empurra o lançamento
 *   para o dia anterior conforme o fuso.
 * - Entre as tabelas do financeiro os vínculos são uuid SEM chave estrangeira,
 *   exceto onde apagar o pai tem de levar o filho (item → meta). A regra de
 *   integridade ("conta com lançamento não se apaga") mora no store, com
 *   mensagem para o dono, não num erro de constraint.
 * - Toda tabela tem `user_id` com cascade: o apagar e o exportar da conta
 *   (account/data.ts) pegam sozinhos.
 */

const dono = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const centavos = (nome: string) => bigint(nome, { mode: "number" });
const dia = (nome: string) => date(nome, { mode: "string" });

/** Renda e teto do mês. Uma linha por dono; ausência = nada informado. */
export const finPerfil = pgTable("fin_perfil", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  renda: centavos("renda").notNull().default(0),
  teto: centavos("teto").notNull().default(0),
  /** a boas-vindas (PRD §10) aparece uma vez só */
  boasVindasVistas: boolean("boas_vindas_vistas").notNull().default(false),
  /** quando o legado `expense` foi copiado (null = ainda não) */
  legadoImportadoEm: timestamp("legado_importado_em"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
});

/** Conta ou carteira: onde o dinheiro fica. */
export const finConta = pgTable("fin_conta", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  nome: text("nome").notNull(),
  tipo: text("tipo", { enum: ["corrente", "dinheiro"] }).notNull().default("corrente"),
  saldoInicial: centavos("saldo_inicial").notNull().default(0),
  cor: text("cor").notNull(),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_conta_user_idx").on(t.userId)]);

export const finCartao = pgTable("fin_cartao", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  nome: text("nome").notNull(),
  limite: centavos("limite").notNull().default(0),
  fechamento: integer("fechamento").notNull(),
  vencimento: integer("vencimento").notNull(),
  contaPagamentoId: uuid("conta_pagamento_id"),
  cor: text("cor").notNull(),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_cartao_user_idx").on(t.userId)]);

export const finCategoria = pgTable("fin_categoria", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  nome: text("nome").notNull(),
  tipo: text("tipo", { enum: ["despesa", "receita"] }).notNull(),
  cor: text("cor").notNull(),
  /** orçamento mensal; 0 = sem orçamento */
  orcamento: centavos("orcamento").notNull().default(0),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_categoria_user_idx").on(t.userId)]);

/** Movimento que já aconteceu, numa conta OU num cartão. */
export const finLancamento = pgTable("fin_lancamento", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  tipo: text("tipo", { enum: ["despesa", "receita"] }).notNull(),
  data: dia("data").notNull(),
  valor: centavos("valor").notNull(),
  descricao: text("descricao"),
  categoriaId: uuid("categoria_id"),
  contaId: uuid("conta_id"),
  cartaoId: uuid("cartao_id"),
  transferencia: boolean("transferencia").notNull().default(false),
  grupoTransferencia: uuid("grupo_transferencia"),
  fixo: boolean("fixo").notNull().default(false),
  estorno: boolean("estorno").notNull().default(false),
  grupoParcela: uuid("grupo_parcela"),
  parcelaN: integer("parcela_n"),
  parcelaDe: integer("parcela_de"),
  metaId: uuid("meta_id"),
  metaItemId: uuid("meta_item_id"),
  /** conta a pagar/receber que gerou este lançamento ao ser quitada (permite desquitar) */
  compromissoId: uuid("compromisso_id"),
  importado: boolean("importado").notNull().default(false),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  index("fin_lancamento_user_data_idx").on(t.userId, t.data),
  index("fin_lancamento_grupo_idx").on(t.grupoParcela),
  index("fin_lancamento_meta_item_idx").on(t.metaItemId),
]);

/** Conta a pagar ou a receber, com vencimento. */
export const finCompromisso = pgTable("fin_compromisso", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  direcao: text("direcao", { enum: ["pagar", "receber"] }).notNull(),
  descricao: text("descricao").notNull(),
  valor: centavos("valor").notNull(),
  vencimento: dia("vencimento").notNull(),
  categoriaId: uuid("categoria_id"),
  contaId: uuid("conta_id"),
  recorrencia: text("recorrencia", { enum: ["mensal", "nenhuma"] }).notNull().default("nenhuma"),
  serieId: uuid("serie_id"),
  diaMes: integer("dia_mes"),
  status: text("status", { enum: ["aberto", "quitado"] }).notNull().default("aberto"),
  quitadoEm: dia("quitado_em"),
  lancamentoId: uuid("lancamento_id"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  // o aviso diário de vencimento varre por dono e vencimento
  index("fin_compromisso_user_venc_idx").on(t.userId, t.vencimento),
  index("fin_compromisso_serie_idx").on(t.serieId),
]);

export const finPagamentoFatura = pgTable("fin_pagamento_fatura", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  cartaoId: uuid("cartao_id").notNull(),
  /** a fatura, identificada pela data de fechamento */
  fechamento: dia("fechamento").notNull(),
  valor: centavos("valor").notNull(),
  data: dia("data").notNull(),
  lancamentoId: uuid("lancamento_id"),
  /** a parte que não foi paga e virou rotativo */
  rolado: boolean("rolado").notNull().default(false),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("fin_pagamento_fatura_cartao_idx").on(t.userId, t.cartaoId)]);

/** Dívida que cobra juros. Conta a pagar comum NÃO mora aqui. */
export const finDivida = pgTable("fin_divida", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  nome: text("nome").notNull(),
  tipo: text("tipo", { enum: ["emprestimo", "cartao-rotativo", "cheque-especial", "crediario", "outro"] }).notNull().default("emprestimo"),
  saldoInicial: centavos("saldo_inicial").notNull().default(0),
  /** % ao mês */
  jurosMes: real("juros_mes").notNull().default(0),
  parcelaMensal: centavos("parcela_mensal").notNull().default(0),
  contaId: uuid("conta_id"),
  /** só no rotativo: o cartão cujo limite ela consome */
  cartaoId: uuid("cartao_id"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("fin_divida_user_idx").on(t.userId)]);

export const finDividaPagamento = pgTable("fin_divida_pagamento", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  dividaId: uuid("divida_id").notNull().references(() => finDivida.id, { onDelete: "cascade" }),
  data: dia("data").notNull(),
  valor: centavos("valor").notNull(),
  juros: centavos("juros").notNull().default(0),
  abatimento: centavos("abatimento").notNull(),
  lancamentoId: uuid("lancamento_id"),
}, (t) => [index("fin_divida_pagamento_divida_idx").on(t.dividaId)]);

/** Cada vez que uma fatura jogou saldo para o rotativo. */
export const finDividaRolagem = pgTable("fin_divida_rolagem", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  dividaId: uuid("divida_id").notNull().references(() => finDivida.id, { onDelete: "cascade" }),
  data: dia("data").notNull(),
  valor: centavos("valor").notNull(),
  fechamento: dia("fechamento").notNull(),
});

/** Projeto com teto próprio (compra do apartamento, reforma, viagem). */
export const finMeta = pgTable("fin_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  orcamento: centavos("orcamento").notNull().default(0),
  cor: text("cor").notNull(),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("fin_meta_user_idx").on(t.userId)]);

export const finMetaItem = pgTable("fin_meta_item", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  metaId: uuid("meta_id").notNull().references(() => finMeta.id, { onDelete: "cascade" }),
  grupo: text("grupo").notNull().default("Sem grupo"),
  nome: text("nome").notNull(),
  valor: centavos("valor").notNull().default(0),
  status: text("status", { enum: ["planejado", "orcado", "contratado", "pago"] }).notNull().default("planejado"),
  forma: text("forma", { enum: ["avista", "cartao", "boleto", "carne"] }).notNull().default("avista"),
  parcelas: integer("parcelas").notNull().default(1),
  primeiroVenc: dia("primeiro_venc"),
  contaId: uuid("conta_id"),
  cartaoId: uuid("cartao_id"),
  obs: text("obs"),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_meta_item_meta_idx").on(t.metaId)]);

/**
 * Foto de referência de um item de meta, já reduzida no navegador (900 px,
 * JPEG). Tabela própria e fora da leitura do painel: o PRD original guardava
 * a foto dentro do estado e o estado inteiro ficava pesado demais para
 * sincronizar (ponto de atenção 9).
 */
export const finMetaFoto = pgTable("fin_meta_foto", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  itemId: uuid("item_id").notNull().references(() => finMetaItem.id, { onDelete: "cascade" }),
  dado: text("dado").notNull(),
  bytes: integer("bytes").notNull(),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("fin_meta_foto_item_idx").on(t.itemId)]);

/** Gasto pré-configurado, lançado com um toque (ou "lança o almoço" por voz). */
export const finAtalho = pgTable("fin_atalho", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  rotulo: text("rotulo").notNull(),
  valor: centavos("valor").notNull(),
  categoriaId: uuid("categoria_id"),
  contaId: uuid("conta_id"),
  cartaoId: uuid("cartao_id"),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_atalho_user_idx").on(t.userId)]);

/** "Se a descrição contiver X, use a categoria Y." */
export const finRegra = pgTable("fin_regra", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  contem: text("contem").notNull(),
  categoriaId: uuid("categoria_id").notNull(),
  ordem: integer("ordem").notNull().default(0),
}, (t) => [index("fin_regra_user_idx").on(t.userId)]);

/**
 * O que um lançamento criado pela Órbita (tela, chat ou voz) pode desfazer.
 * Guarda os ids criados por uma ação, para "desfaz o último" funcionar por
 * voz sem o modelo ter de lembrar ids de três turnos atrás.
 */
export const finDesfazer = pgTable("fin_desfazer", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  descricao: text("descricao").notNull(),
  lancamentoIds: uuid("lancamento_ids").array().notNull(),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [index("fin_desfazer_user_idx").on(t.userId, t.criadoEm)]);

export type FinConta = typeof finConta.$inferSelect;
export type FinCartao = typeof finCartao.$inferSelect;
export type FinCategoria = typeof finCategoria.$inferSelect;
export type FinLancamento = typeof finLancamento.$inferSelect;
export type FinCompromisso = typeof finCompromisso.$inferSelect;
export type FinPagamentoFatura = typeof finPagamentoFatura.$inferSelect;
export type FinDivida = typeof finDivida.$inferSelect;
export type FinDividaPagamento = typeof finDividaPagamento.$inferSelect;
export type FinDividaRolagem = typeof finDividaRolagem.$inferSelect;
export type FinMeta = typeof finMeta.$inferSelect;
export type FinMetaItem = typeof finMetaItem.$inferSelect;
export type FinAtalho = typeof finAtalho.$inferSelect;
export type FinRegra = typeof finRegra.$inferSelect;
