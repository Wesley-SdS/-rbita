import { pgTable, text, timestamp, uuid, integer, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

/**
 * FILA DE TRABALHO PESADO.
 *
 * Até aqui, recalcular assinaturas, resumir uma reunião, indexar um documento e
 * ler um cupom aconteciam DENTRO da requisição, com o dono esperando. Três
 * problemas, nesta ordem de gravidade:
 *   1. o proxy do Next em dev derruba upstream lento (~30 s), então a falha que
 *      o dono via era um erro de rede genérico, não o que de fato aconteceu;
 *   2. não havia progresso: recalcular 40 amostras parecia travado;
 *   3. falha não tinha segunda chance nem ficava registrada.
 *
 * O desenho segue o consenso de graphile-worker, pg-boss, River e Oban, podado
 * para o tamanho desta casa (um worker, dezenas de trabalhos por dia):
 *   - claim por UPDATE atômico com `FOR UPDATE SKIP LOCKED` na subconsulta e
 *     commit imediato. Transação aberta durante o trabalho seguraria o
 *     horizonte do MVCC por minutos, que é o antipadrão clássico de fila;
 *   - `locked_by` + `heartbeat_at` no lugar de transação longa: trabalho que
 *     morreu com o processo é reconhecido pelo id da instância, e trabalho que
 *     travou vivo é reconhecido pelo coração parado;
 *   - `dedup_key` com índice único PARCIAL (só nos estados não terminais),
 *     como o River faz: dois cliques não viram dois trabalhos, e a mesma chave
 *     pode voltar depois que o anterior terminou;
 *   - `cancel_requested` em vez de matar a execução: todo handler aqui é um
 *     laço, então ele para no próximo ponto seguro.
 *
 * O `input` guarda o arquivo de entrada como data URL (mesmo formato do
 * snapshot de câmera) e é ZERADO ao terminar: é o maior peso da tabela e,
 * quando é áudio de voz, é biometria (CLAUDE.md §5.4.1).
 */
export const job = pgTable(
  "job",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** identificador do handler, ex.: "identidade.recalcular_voz" */
    kind: text("kind").notNull(),
    /** pendente | rodando | feito | falhou | cancelado */
    status: text("status").notNull().default("pendente"),
    /** o que aparece na tela, em pt-BR, escrito por quem enfileirou */
    title: text("title").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** entrada pesada (data URL de imagem, PDF ou áudio); zerada ao terminar */
    input: text("input"),
    /** mesma chave = mesmo trabalho enquanto ele não terminar */
    dedupKey: text("dedup_key"),
    progressDone: integer("progress_done").notNull().default(0),
    /** nulo enquanto o total não é conhecido (ex.: antes de contar as amostras) */
    progressTotal: integer("progress_total"),
    /** passo atual em pt-BR, ex.: "resumindo o bloco 3 de 12" */
    step: text("step"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    /** erro que não adianta retentar (validação, sem consentimento, 4xx) */
    errorPermanent: boolean("error_permanent").notNull().default(false),
    /** o dono mandou parar: o handler para no próximo ponto seguro */
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** quando pode rodar: agora, ou depois da espera da retentativa */
    runAt: timestamp("run_at").defaultNow().notNull(),
    /** id da instância do apps/api que pegou o trabalho */
    lockedBy: text("locked_by"),
    /** última prova de vida do handler (vem junto com o progresso) */
    heartbeatAt: timestamp("heartbeat_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // índice PARCIAL: com o tempo, quase toda linha está em estado terminal, e
    // o runner só pergunta pelas pendentes
    index("job_pronto_idx").on(t.runAt).where(sql`${t.status} = 'pendente'`),
    uniqueIndex("job_dedup_idx")
      .on(t.dedupKey)
      .where(sql`${t.dedupKey} is not null and ${t.status} in ('pendente', 'rodando')`),
    index("job_user_idx").on(t.userId, t.createdAt),
  ],
);

export type Job = typeof job.$inferSelect;
export type JobStatus = "pendente" | "rodando" | "feito" | "falhou" | "cancelado";
