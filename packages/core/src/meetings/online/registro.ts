import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { reuniaoImportada } from "@orbita/db/meeting-schema";
import { job } from "@orbita/db/job-schema";

/**
 * A memória do que já foi importado (`reuniao_importada`): o único lugar que
 * fala com o banco nas reuniões online. Separado do orquestrador para ele ser
 * testado sem banco.
 */

const esperaPadrao = (tentativas: number) => 15 * 60_000 * 2 ** Math.max(0, tentativas - 1);

export interface Registro {
  externalId: string;
  situacao: string;
  proximaTentativa: Date | null;
}

export async function registrosDaFonte(userId: string, fonte: string, ids: string[]): Promise<Registro[]> {
  if (!ids.length) return [];
  return db
    .select({ externalId: reuniaoImportada.externalId, situacao: reuniaoImportada.situacao, proximaTentativa: reuniaoImportada.proximaTentativa })
    .from(reuniaoImportada)
    .where(and(eq(reuniaoImportada.userId, userId), eq(reuniaoImportada.fonte, fonte), inArray(reuniaoImportada.externalId, ids)));
}

/** A trava: linha nova, ou a que falhou e chegou a vez. Devolve o id, ou null se já é de outro. */
export async function travar(userId: string, fonte: string, g: { externalId: string; inicio: Date | null }, titulo: string, curta: boolean): Promise<string | null> {
  const situacao = curta ? "curta" : "resumindo";
  const [linha] = await db
    .insert(reuniaoImportada)
    .values({ userId, fonte, externalId: g.externalId, titulo, inicio: g.inicio, situacao })
    .onConflictDoUpdate({
      target: [reuniaoImportada.userId, reuniaoImportada.fonte, reuniaoImportada.externalId],
      set: { situacao, titulo, criadoEm: new Date() },
      setWhere: eq(reuniaoImportada.situacao, "falhou"),
    })
    .returning({ id: reuniaoImportada.id });
  return linha?.id ?? null;
}

export async function anotarTrabalho(id: string, jobId: string): Promise<void> {
  await db.update(reuniaoImportada).set({ jobId }).where(eq(reuniaoImportada.id, id));
}

/** Falha registrada na própria linha: tentativa a mais, espera crescente, e desiste no teto. */
export async function registrarFalha(userId: string, f: string, g: { externalId: string; inicio: Date | null }, titulo: string, erro: string, maxTentativas: number, agora: Date, esperaDaTentativa: (n: number) => number = esperaPadrao) {
  const [atual] = await db
    .select({ tentativas: reuniaoImportada.tentativas })
    .from(reuniaoImportada)
    .where(and(eq(reuniaoImportada.userId, userId), eq(reuniaoImportada.fonte, f), eq(reuniaoImportada.externalId, g.externalId)))
    .limit(1);
  const tentativas = (atual?.tentativas ?? 0) + 1;
  const valores = {
    situacao: tentativas >= maxTentativas ? "desistiu" : "falhou",
    tentativas,
    ultimoErro: erro.slice(0, 300),
    proximaTentativa: new Date(agora.getTime() + esperaDaTentativa(tentativas)),
    jobId: null,
  };
  await db
    .insert(reuniaoImportada)
    .values({ userId, fonte: f, externalId: g.externalId, titulo: titulo.slice(0, 200), inicio: g.inicio, ...valores })
    .onConflictDoUpdate({ target: [reuniaoImportada.userId, reuniaoImportada.fonte, reuniaoImportada.externalId], set: valores });
}

/**
 * O resumo que não aconteceu: o trabalho falhou ou foi cancelado (e a fila
 * apaga a transcrição do `input` ao terminar), ou o processo caiu entre
 * registrar e enfileirar. Sem isto a linha ficava "resumindo" para sempre e a
 * reunião nunca mais voltava.
 */
export async function reconciliar(userId: string, maxTentativas: number, agora: Date, esperaDaTentativa: (n: number) => number = esperaPadrao): Promise<void> {
  const presas = await db
    .select({ id: reuniaoImportada.id, tentativas: reuniaoImportada.tentativas, jobId: reuniaoImportada.jobId, criadoEm: reuniaoImportada.criadoEm, status: job.status })
    .from(reuniaoImportada)
    // job.id é uuid e a coluna guarda texto: sem o cast o Postgres recusa a comparação
    .leftJoin(job, sql`${job.id}::text = ${reuniaoImportada.jobId}`)
    .where(and(eq(reuniaoImportada.userId, userId), eq(reuniaoImportada.situacao, "resumindo"), or(inArray(job.status, ["falhou", "cancelado"]), and(isNull(reuniaoImportada.jobId), lt(reuniaoImportada.criadoEm, new Date(agora.getTime() - 10 * 60_000))))));
  for (const p of presas) {
    const tentativas = p.tentativas + 1;
    await db
      .update(reuniaoImportada)
      .set({
        situacao: tentativas >= maxTentativas ? "desistiu" : "falhou",
        tentativas,
        ultimoErro: p.jobId ? `o resumo ${p.status === "cancelado" ? "foi cancelado" : "falhou"}` : "o processo caiu antes de enfileirar",
        proximaTentativa: new Date(agora.getTime() + esperaDaTentativa(tentativas)),
        jobId: null,
      })
      .where(eq(reuniaoImportada.id, p.id));
  }
}

