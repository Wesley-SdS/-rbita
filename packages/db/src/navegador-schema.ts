import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * CHROME DO DONO (PRD-COMPUTADOR-E-NAVEGADOR, frente B).
 *
 * `navegador_extensao`: cada extensão pareada. Só o HASH do token fica aqui
 * (sha256): quem ler o banco não consegue se passar pela extensão. Revogar
 * marca `revogada_em` e o gateway derruba a conexão na hora.
 */
export const navegadorExtensao = pgTable(
  "navegador_extensao",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** nome que a extensão deu de si ("Chrome 155 no PC da sala") */
    nome: text("nome").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** versão da extensão vista na última conexão */
    versao: text("versao"),
    criadaEm: timestamp("criada_em").defaultNow().notNull(),
    vistaEm: timestamp("vista_em"),
    revogadaEm: timestamp("revogada_em"),
  },
  (t) => [uniqueIndex("navegador_extensao_token").on(t.tokenHash), index("navegador_extensao_user").on(t.userId)],
);
export type NavegadorExtensao = typeof navegadorExtensao.$inferSelect;

/**
 * O que a Órbita pode fazer em cada site (B2): `bloqueado` (nem o título entra
 * no contexto), `leitura` ou `escrita` (agir dentro da sessão). Site sem linha
 * usa `navegador.padraoSite`; as categorias bloqueadas vencem qualquer linha.
 * Muda só pela tela, com OwnerGuard: não existe tool que mexa nisto (PRD §2.3).
 */
export const navegadorSite = pgTable(
  "navegador_site",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** domínio normalizado ("jira.atlassian.net"); vale para os subdomínios */
    dominio: text("dominio").notNull(),
    /** "bloqueado" | "leitura" | "escrita" */
    modo: text("modo").notNull(),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("navegador_site_user_dominio").on(t.userId, t.dominio)],
);
export type NavegadorSite = typeof navegadorSite.$inferSelect;

/** Um passo de roteiro: a ação e o alvo SEMÂNTICO (papel, nome, texto), com um seletor de reserva. */
export interface PassoDeRoteiro {
  acao: string;
  alvo?: { papel?: string | null; nome?: string | null; texto?: string | null; seletor?: string | null } | null;
  /** valor a preencher, tecla, direção de rolagem; nunca senha (o executor recusa) */
  valor?: string | number | boolean | null;
  url?: string | null;
}

/**
 * ROTEIROS (B4): tarefa que deu certo vira roteiro para a próxima vez rodar sem
 * o modelo. Passo com efeito reexecutado continua indo para a fila: o roteiro
 * poupa modelo, não aprovação.
 */
export const navegadorRoteiro = pgTable(
  "navegador_roteiro",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dominio: text("dominio").notNull(),
    /** o objetivo como o dono pediu */
    intencao: text("intencao").notNull(),
    /** a intenção normalizada (sem acento, caixa e pontuação), que é a chave de busca */
    intencaoChave: text("intencao_chave").notNull(),
    passos: jsonb("passos").$type<PassoDeRoteiro[]>().notNull(),
    /** tokens que a primeira execução (com o modelo) gastou, para comparar */
    tokensAprendizado: integer("tokens_aprendizado").notNull().default(0),
    usos: integer("usos").notNull().default(0),
    falhas: integer("falhas").notNull().default(0),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    usadoEm: timestamp("usado_em"),
  },
  (t) => [uniqueIndex("navegador_roteiro_chave").on(t.userId, t.dominio, t.intencaoChave)],
);
export type NavegadorRoteiro = typeof navegadorRoteiro.$inferSelect;
