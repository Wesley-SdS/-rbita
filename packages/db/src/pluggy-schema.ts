import { index, pgTable, text, timestamp, uuid, boolean, bigint, date, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/*
 * OPEN FINANCE pela Pluggy. As credenciais da aplicação (clientId e
 * clientSecret) NÃO moram aqui: ficam cifradas na tabela `connection`, como
 * qualquer conector por token. Aqui estão só o que a sincronização precisa
 * lembrar entre uma volta e outra.
 *
 * Vínculos com o financeiro (`fin_*`) são uuid SEM chave estrangeira, na mesma
 * convenção de `finance-schema.ts`: a integridade ("conta com lançamento não se
 * apaga") mora no store, com mensagem para o dono.
 */

const dono = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

/** Uma conexão com um banco na Pluggy (o "item"). O dono cola o id que a Pluggy mostra. */
export const pluggyItem = pgTable("pluggy_item", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  /** o id do item NA Pluggy */
  itemId: text("item_id").notNull(),
  banco: text("banco").notNull().default("Banco"),
  /** UPDATED, UPDATING, LOGIN_ERROR, WAITING_USER_INPUT, OUTDATED… como a Pluggy diz */
  status: text("status"),
  executionStatus: text("execution_status"),
  /** a última vez que a PLUGGY leu o banco (não a nossa leitura da Pluggy) */
  atualizadoNoBancoEm: timestamp("atualizado_no_banco_em"),
  sincronizadoEm: timestamp("sincronizado_em"),
  erro: text("erro"),
  /** o status que já foi avisado ao dono (LOGIN_ERROR…), para avisar UMA vez e não a cada volta */
  avisoStatus: text("aviso_status"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [uniqueIndex("pluggy_item_user_item_idx").on(t.userId, t.itemId)]);

/** Uma conta (ou cartão) dentro de um item. Só conta corrente e poupança sincronizam por ora. */
export const pluggyConta = pgTable("pluggy_conta", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  itemRef: uuid("item_ref").notNull().references(() => pluggyItem.id, { onDelete: "cascade" }),
  /** o id da conta NA Pluggy */
  pluggyId: text("pluggy_id").notNull(),
  tipo: text("tipo", { enum: ["BANK", "CREDIT"] }).notNull(),
  subtipo: text("subtipo"),
  nome: text("nome").notNull(),
  numero: text("numero"),
  /** CPF/CNPJ do titular, só dígitos: é como uma transferência para si mesmo é reconhecida */
  titularDocumento: text("titular_documento"),
  /** saldo que o banco informou, em centavos, e quando */
  saldoBanco: bigint("saldo_banco", { mode: "number" }),
  saldoBancoEm: timestamp("saldo_banco_em"),
  /** a conta da Órbita que recebe os lançamentos; null = ainda não vinculada */
  contaId: uuid("conta_id"),
  /** cartão: o cartão da Órbita que recebe as compras (no lugar de `contaId`) */
  cartaoId: uuid("cartao_id"),
  /** cartão: o que a Pluggy informa, para criar o cartão certo sem inventar número */
  limite: bigint("limite", { mode: "number" }),
  diaFechamento: integer("dia_fechamento"),
  diaVencimento: integer("dia_vencimento"),
  /** quando o dono escolhe não sincronizar esta conta */
  ativa: boolean("ativa").notNull().default(true),
  /** a primeira leitura já aconteceu (é nela que o saldo inicial se acerta) */
  importadaEm: timestamp("importada_em"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pluggy_conta_user_pluggy_idx").on(t.userId, t.pluggyId),
  index("pluggy_conta_item_idx").on(t.itemRef),
]);

/**
 * De onde veio cada lançamento do banco. É a trava contra duplicar: o id da
 * transação na Pluggy é único por dono, então ler o mesmo extrato de novo não
 * lança nada, MESMO que o dono tenha apagado ou editado o lançamento (apagar
 * é uma decisão, e a sincronização não a desfaz). `lancamentoId` sem chave
 * estrangeira pelo mesmo motivo.
 */
export const pluggyTransacao = pgTable("pluggy_transacao", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: dono(),
  contaRef: uuid("conta_ref").notNull().references(() => pluggyConta.id, { onDelete: "cascade" }),
  /** o id da transação NA Pluggy */
  pluggyId: text("pluggy_id").notNull(),
  data: date("data", { mode: "string" }).notNull(),
  natureza: text("natureza", { enum: ["despesa", "receita"] }).notNull(),
  valor: bigint("valor", { mode: "number" }).notNull(),
  descricao: text("descricao").notNull().default(""),
  /** o lançamento criado; null quando a linha já existia lançada à mão (`ignorada`) */
  lancamentoId: uuid("lancamento_id"),
  estado: text("estado", { enum: ["lancada", "ja_existia"] }).notNull().default("lancada"),
  /** havia um terceiro identificado do outro lado: nunca casa como transferência entre contas minhas */
  terceiro: boolean("terceiro").notNull().default(false),
  /** preenchido quando a linha é uma perna de transferência entre contas */
  grupoTransferencia: uuid("grupo_transferencia"),
  criadoEm: timestamp("criado_em").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pluggy_transacao_user_pluggy_idx").on(t.userId, t.pluggyId),
  index("pluggy_transacao_user_data_idx").on(t.userId, t.data),
  index("pluggy_transacao_conta_idx").on(t.contaRef),
]);

export type PluggyItem = typeof pluggyItem.$inferSelect;
export type PluggyConta = typeof pluggyConta.$inferSelect;
export type PluggyTransacao = typeof pluggyTransacao.$inferSelect;
