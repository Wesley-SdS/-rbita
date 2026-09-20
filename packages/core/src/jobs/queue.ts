import { and, asc, desc, eq, getTableColumns, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { job, type Job } from "@orbita/db/job-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { log } from "../observability/logger";
import { decidirFalha, ehZumbi, mensagemDeErro, proximaEspera } from "./policy";
import { jobDef } from "./registry";

/**
 * A fila em si. Cada função aqui é uma transação de milissegundos: o trabalho
 * pesado roda FORA de transação, com o estado no banco (ver o comentário do
 * schema). Um worker, um trabalho por vez.
 */

/** Erro que não deve ser retentado: validação, consentimento, 4xx. */
export class JobPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobPermanentError";
  }
}

// quem enfileira e quem executa vivem no MESMO processo (apps/api), então
// acordar o runner é uma chamada de função: nada de LISTEN/NOTIFY, que exigiria
// conexão dedicada fora do pool para resolver um problema que não existe aqui
let acordar: (() => void) | null = null;
export function onJobEnqueued(cb: () => void): void {
  acordar = cb;
}

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  input?: string | null;
  /** mesma chave = mesmo trabalho enquanto ele não termina (dois cliques, um job) */
  dedupKey?: string | null;
  /** sobrescreve o padrão do handler e a config */
  maxAttempts?: number;
  titulo?: string;
}

export interface EnqueueResult {
  job: Job;
  /** true quando a chave de dedup bateu e o trabalho já existia */
  jaExistia: boolean;
}

export async function enqueueJob(userId: string, input: EnqueueInput): Promise<EnqueueResult> {
  const def = jobDef(input.kind);
  if (!def) throw new JobPermanentError(`Não existe trabalho registrado com o nome "${input.kind}".`);
  const payload = input.payload ?? {};
  const cfg = await settings.getMany(["jobs.maxAttempts"]);

  const valores = {
    userId,
    kind: input.kind,
    title: input.titulo ?? def.title(payload),
    payload,
    input: input.input ?? null,
    dedupKey: input.dedupKey ?? null,
    maxAttempts: input.maxAttempts ?? def.maxAttempts ?? cfg["jobs.maxAttempts"],
  };

  // o índice único é PARCIAL (só estados não terminais), então o conflito só
  // acontece enquanto o trabalho igual ainda está vivo
  const [row] = await db.insert(job).values(valores).onConflictDoNothing().returning();
  if (row) {
    await events.emit("job.enqueued", { jobId: row.id, kind: row.kind, titulo: row.title }, { userId }).catch(() => undefined);
    acordar?.();
    return { job: row, jaExistia: false };
  }

  const existente = input.dedupKey ? await jobByDedup(userId, input.dedupKey) : null;
  if (!existente) throw new Error("Não consegui enfileirar o trabalho.");
  return { job: existente, jaExistia: true };
}

async function jobByDedup(userId: string, dedupKey: string): Promise<Job | null> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.userId, userId), eq(job.dedupKey, dedupKey), inArray(job.status, ["pendente", "rodando"])))
    .limit(1);
  return row ?? null;
}

/**
 * Pega UM trabalho pronto e marca como rodando, numa query só.
 *
 * `FOR UPDATE SKIP LOCKED` na subconsulta é o padrão desde o PG 9.5: sem ele,
 * dois runners (o `tsx watch` recarregando deixa dois vivos por alguns
 * segundos) pegariam a mesma linha. `attempts + 1` acontece AQUI, no claim, e
 * não no erro: assim a tentativa conta mesmo se o processo morrer no meio.
 */
export async function claimJob(instanciaId: string): Promise<Job | null> {
  const agora = new Date();
  const rows = await db
    .update(job)
    .set({
      status: "rodando",
      attempts: sql`${job.attempts} + 1`,
      lockedBy: instanciaId,
      heartbeatAt: agora,
      startedAt: sql`coalesce(${job.startedAt}, now())`,
      updatedAt: agora,
    })
    .where(
      sql`${job.id} = (select id from ${job} where status = 'pendente' and run_at <= now() order by run_at, created_at for update skip locked limit 1)`,
    )
    .returning();
  return rows[0] ?? null;
}

export interface ProgressoResultado {
  cancelado: boolean;
}

/**
 * Grava progresso E prova de vida na mesma query, e devolve se o dono pediu
 * para parar. Todo handler daqui é um laço, então o ponto de checagem já
 * existe de graça.
 */
export async function reportProgress(jobId: string, feito: number, total?: number | null, passo?: string): Promise<ProgressoResultado> {
  const [row] = await db
    .update(job)
    .set({
      progressDone: feito,
      ...(total === undefined ? {} : { progressTotal: total }),
      ...(passo === undefined ? {} : { step: passo }),
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(job.id, jobId))
    .returning({ cancel: job.cancelRequested });
  return { cancelado: row?.cancel === true };
}

/** Terminou bem: guarda o resultado e joga fora o anexo (§5.4.1 quando é áudio). */
export async function finishJob(jobId: string, resultado: Record<string, unknown> | null): Promise<void> {
  const agora = new Date();
  const [row] = await db
    .update(job)
    .set({ status: "feito", result: resultado ?? {}, input: null, error: null, step: null, finishedAt: agora, updatedAt: agora, lockedBy: null })
    // cerca: só conclui quem ainda está rodando. Se a recuperação de zumbi já
    // devolveu este trabalho para a fila, esta execução atrasada não sobrescreve
    .where(and(eq(job.id, jobId), eq(job.status, "rodando")))
    .returning({ userId: job.userId, kind: job.kind, title: job.title });
  if (row) await events.emit("job.finished", { jobId, kind: row.kind, titulo: row.title, status: "feito" }, { userId: row.userId }).catch(() => undefined);
}

/** Parou porque o dono mandou parar. Não é falha, e não retenta. */
export async function markCancelled(jobId: string): Promise<void> {
  const agora = new Date();
  await db
    .update(job)
    .set({ status: "cancelado", input: null, step: null, finishedAt: agora, updatedAt: agora, lockedBy: null })
    .where(and(eq(job.id, jobId), eq(job.status, "rodando")));
}

/** Falhou: ou volta para a fila com espera, ou desiste e aparece na tela. */
export async function failJob(j: Job, erro: unknown, permanente = erro instanceof JobPermanentError): Promise<"retentar" | "desistir"> {
  const cfg = await settings.getMany(["jobs.retryBaseSeconds", "jobs.retryMaxSeconds"]);
  const decisao = decidirFalha(j.attempts, j.maxAttempts, permanente);
  const mensagem = mensagemDeErro(erro);
  const agora = new Date();

  if (decisao === "retentar") {
    const espera = proximaEspera(j.attempts, cfg["jobs.retryBaseSeconds"] * 1000, cfg["jobs.retryMaxSeconds"] * 1000);
    await db
      .update(job)
      .set({ status: "pendente", error: mensagem, errorPermanent: false, runAt: new Date(agora.getTime() + espera), lockedBy: null, updatedAt: agora })
      .where(and(eq(job.id, j.id), eq(job.status, "rodando")));
    log.warn("job.retentar", { jobId: j.id, kind: j.kind, tentativa: j.attempts, esperaMs: espera, erro: mensagem });
    return "retentar";
  }

  await db
    .update(job)
    .set({ status: "falhou", error: mensagem, errorPermanent: permanente, input: null, finishedAt: agora, updatedAt: agora, lockedBy: null })
    .where(and(eq(job.id, j.id), eq(job.status, "rodando")));
  log.error("job.falhou", { jobId: j.id, kind: j.kind, tentativas: j.attempts, permanente, erro: mensagem });
  await events.emit("job.finished", { jobId: j.id, kind: j.kind, titulo: j.title, status: "falhou", erro: mensagem }, { userId: j.userId }).catch(() => undefined);
  return "desistir";
}

/** Prova de vida de um trabalho em execução (o runner chama num relógio próprio). */
export async function touchHeartbeat(jobId: string): Promise<void> {
  await db.update(job).set({ heartbeatAt: new Date() }).where(and(eq(job.id, jobId), eq(job.status, "rodando")));
}

/**
 * Trabalho que ficou "rodando" sem ninguém tocando: o processo que o pegou
 * morreu. Ver `ehZumbi` para o porquê de ser por coração parado e não por id
 * de instância. `emExecucao` é o que ESTE processo está rodando agora.
 */
/**
 * Quem está "rodando" desde antes do corte.
 *
 * Fica separado para poder ser inspecionado em teste sem banco, porque foi
 * exatamente aqui que morava um bug que ficou calado: o lado esquerdo é um
 * `coalesce` CRU, não uma coluna tipada, então o Drizzle não tem o tipo para
 * mapear o valor e serializa um `Date` com `toString()`. O Postgres recebia
 * "Sun Sep 20 2026 15:56:47 GMT-0300 (Horário Padrão de Brasília)", recusava
 * com `invalid input syntax for type timestamp`, e a recuperação falhava a
 * cada volta do agendador — silenciosa, porque o erro morria num `catch`.
 *
 * O efeito era o pior: trabalho preso por processo morto nunca voltava à fila.
 * Daí o `toISOString()`, que não é enfeite.
 */
export function rodandoDesdeAntesDe(corte: Date) {
  return and(
    eq(job.status, "rodando"),
    lt(sql`coalesce(${job.heartbeatAt}, ${job.startedAt}, ${job.createdAt})`, corte.toISOString()),
  );
}

export async function recoverZombies(emExecucao: ReadonlySet<string>): Promise<{ devolvidos: number; desistidos: number }> {
  const paradoMs = (await settings.get("jobs.staleMinutes")) * 60_000;
  const agora = new Date();
  const corte = new Date(agora.getTime() - paradoMs);
  const candidatos = await db
    .select()
    .from(job)
    .where(rodandoDesdeAntesDe(corte));
  const zumbis = candidatos.filter((c) => ehZumbi(c, emExecucao, paradoMs, agora));
  let devolvidos = 0;
  let desistidos = 0;
  for (const z of zumbis) {
    const r = await failJob(z, new Error("O processo caiu durante a execução."), false);
    if (r === "retentar") devolvidos++;
    else desistidos++;
  }
  if (zumbis.length) log.warn("job.zumbis", { devolvidos, desistidos });
  return { devolvidos, desistidos };
}

/** Pedido de parada: o handler vê no próximo progresso. Pendente para na hora. */
export async function cancelJob(userId: string, jobId: string): Promise<Job | null> {
  const [atual] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.userId, userId))).limit(1);
  if (!atual) return null;
  if (atual.status === "pendente") {
    const [row] = await db
      .update(job)
      .set({ status: "cancelado", cancelRequested: true, input: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(job.id, jobId))
      .returning();
    return row ?? null;
  }
  if (atual.status !== "rodando") return atual;
  const [row] = await db.update(job).set({ cancelRequested: true, updatedAt: new Date() }).where(eq(job.id, jobId)).returning();
  return row ?? null;
}

/**
 * Colunas para a TELA: tudo menos o `input`. O anexo de uma reunião longa tem
 * mais de cem megas, e a tela pergunta o status a cada poucos segundos.
 */
const { input: _semAnexo, ...colunasDaTela } = getTableColumns(job);
const semAnexo = (j: Omit<Job, "input">): Job => ({ ...j, input: null });

export async function getJob(userId: string, jobId: string): Promise<Job | null> {
  const [row] = await db.select(colunasDaTela).from(job).where(and(eq(job.id, jobId), eq(job.userId, userId))).limit(1);
  return row ? semAnexo(row) : null;
}

export async function listJobs(userId: string, opts: { status?: string[]; limite?: number } = {}): Promise<Job[]> {
  const onde = opts.status?.length ? and(eq(job.userId, userId), inArray(job.status, opts.status)) : eq(job.userId, userId);
  const rows = await db.select(colunasDaTela).from(job).where(onde).orderBy(desc(job.createdAt)).limit(opts.limite ?? 30);
  return rows.map(semAnexo);
}

/** Trabalho ainda vivo deste tipo (a tela usa para não enfileirar duas vezes). */
export async function activeJobOfKind(userId: string, kind: string): Promise<Job | null> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.userId, userId), eq(job.kind, kind), inArray(job.status, ["pendente", "rodando"])))
    .orderBy(asc(job.createdAt))
    .limit(1);
  return row ?? null;
}

/** Faxina: concluídos saem antes; falhados ficam mais tempo, porque explicam algo. */
export async function purgeJobs(diasFeito: number, diasFalhou: number): Promise<number> {
  const agora = Date.now();
  const r = await db
    .delete(job)
    .where(
      or(
        and(inArray(job.status, ["feito", "cancelado"]), lt(job.updatedAt, new Date(agora - diasFeito * 86_400_000))),
        and(eq(job.status, "falhou"), lt(job.updatedAt, new Date(agora - diasFalhou * 86_400_000))),
      ),
    )
    .returning({ id: job.id });
  return r.length;
}
