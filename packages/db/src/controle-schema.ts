import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * SESSÃO DE CONTROLE (PRD-COMPUTADOR-E-NAVEGADOR F2): o envelope que o dono
 * aprovou para a Órbita agir no computador ou no Chrome.
 *
 * A linha nasce ATIVA, na execução pós-aprovação do `controle_iniciar`, a
 * partir do payload que o `preparar` fixou. A proposta em si mora na
 * `action_queue` (é lá que o dono aprova o resumo), por isso não existe linha
 * "proposta" aqui: uma linha criada antes da aprovação poderia ser lida como
 * envelope por um bug, e o envelope só vale depois do humano.
 *
 * Nada aqui muda por tool depois de nascer, a não ser `passos_usados`,
 * `vetos_seguidos` e o `status` (só para baixo: ativa → pausada, encerrada ou
 * parada). Ampliar é propor um envelope novo (PRD §2.3).
 */
export const controleSessao = pgTable(
  "controle_sessao",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "computador" | "navegador" | "ambos" */
    alvo: text("alvo").notNull(),
    objetivo: text("objetivo").notNull(),
    /** o pedido do dono como chegou ao código (texto literal), ou a versão do modelo quando o canal não traz a fala */
    pedidoOriginal: text("pedido_original").notNull(),
    /** `false` quando o pedido veio do modelo (voz em tempo real): o crítico e a tela sabem disso */
    pedidoLiteral: boolean("pedido_literal").notNull().default(true),
    apps: jsonb("apps").$type<string[]>().notNull().default([]),
    sites: jsonb("sites").$type<string[]>().notNull().default([]),
    tetoPassos: integer("teto_passos").notNull(),
    passosUsados: integer("passos_usados").notNull().default(0),
    tetoMinutos: integer("teto_minutos").notNull(),
    expiraEm: timestamp("expira_em").notNull(),
    /** "ativa" | "pausada" | "encerrada" | "parada" */
    status: text("status").notNull().default("ativa"),
    /** por que saiu de ativa: "teto de passos", "tempo", "dois vetos", "o dono mexeu", "encerrada pelo dono"… */
    motivo: text("motivo"),
    vetosSeguidos: integer("vetos_seguidos").notNull().default(0),
    /** canal em que a sessão foi pedida (tela, voz, whatsapp) */
    canal: text("canal").notNull().default("tela"),
    /** o PC que ela controla; na v1 é sempre o do apps/api (PRD §15) */
    maquina: text("maquina").notNull(),
    /** a proposta aprovada que a abriu (sem FK: a fila tem retenção própria) */
    acaoId: text("acao_id"),
    criadaEm: timestamp("criada_em").defaultNow().notNull(),
    atualizadaEm: timestamp("atualizada_em").defaultNow().notNull(),
    terminadaEm: timestamp("terminada_em"),
  },
  (t) => [index("controle_sessao_user_status").on(t.userId, t.status, t.criadaEm), index("controle_sessao_terminada").on(t.terminadaEm)],
);
export type ControleSessao = typeof controleSessao.$inferSelect;

/**
 * TRILHA (F3): cada passo das tools de controle, terminal, arquivos,
 * computador e navegador. Gravado ANTES de executar (`decisao = executando`) e
 * atualizado depois: um processo que morre no meio deixa o rastro do que
 * tentou. `sessao_id` é opcional porque um comando avulso aprovado não tem
 * sessão. `alvo` guarda só campos curtos e conhecidos da entrada, nunca o
 * texto a digitar nem o conteúdo de arquivo (ver `controle/trilha.ts`).
 */
export const controlePasso = pgTable(
  "controle_passo",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessaoId: uuid("sessao_id").references(() => controleSessao.id, { onDelete: "cascade" }),
    /** a proposta da fila, quando o passo esperou aprovação */
    acaoId: text("acao_id"),
    tool: text("tool").notNull(),
    acao: text("acao"),
    alvo: jsonb("alvo").$type<Record<string, unknown>>().notNull().default({}),
    risco: text("risco").notNull(),
    /** "executando" | "executado" | "vetado" | "recusado" | "na_fila" | "falhou" */
    decisao: text("decisao").notNull(),
    resultado: text("resultado"),
    duracaoMs: integer("duracao_ms"),
    /** data URL pequena, só com `controle.guardarMiniaturas` ligado */
    miniatura: text("miniatura"),
    canal: text("canal"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    atualizadoEm: timestamp("atualizado_em").defaultNow().notNull(),
  },
  (t) => [index("controle_passo_user_quando").on(t.userId, t.criadoEm), index("controle_passo_sessao").on(t.sessaoId, t.criadoEm), index("controle_passo_acao").on(t.acaoId)],
);
export type ControlePasso = typeof controlePasso.$inferSelect;
