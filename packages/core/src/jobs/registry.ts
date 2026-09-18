import type { Job } from "@orbita/db/job-schema";

/**
 * REGISTRO DE TRABALHOS PESADOS, no mesmo espírito do registro de tools
 * (CLAUDE.md §5.7): cada tipo de trabalho mora no módulo dele e se registra.
 * O runner do `apps/api` não conhece nenhum tipo por nome, só o registro.
 *
 * O handler recebe um `progresso` porque a tela precisa mostrar "3 de 12": sem
 * isso, recalcular 40 amostras parece travado, que foi exatamente a queixa que
 * originou esta fila.
 */

export interface JobRunContext {
  userId: string;
  payload: Record<string, unknown>;
  /** entrada pesada (data URL), quando o trabalho nasceu de um upload */
  input: string | null;
  /** id do job, para o handler registrar o que quiser na trilha */
  jobId: string;
  /** conta quanto já foi feito; `passo` é texto em pt-BR para a tela */
  progresso: (feito: number, total?: number | null, passo?: string) => Promise<void>;
  /** true quando o dono cancelou: o handler deve parar no próximo ponto seguro */
  cancelado: () => Promise<boolean>;
}

export interface JobDef {
  /** identificador estável, ex.: "identidade.recalcular_voz" */
  kind: string;
  /** o que aparece na tela, em pt-BR, a partir do que foi enfileirado */
  title: (payload: Record<string, unknown>) => string;
  /**
   * Tentativas no total (a primeira conta). Trabalho que depende de serviço
   * externo merece mais; trabalho determinístico que falhou vai falhar de novo.
   */
  maxAttempts?: number;
  run: (ctx: JobRunContext) => Promise<Record<string, unknown> | void>;
}

const registro = new Map<string, JobDef>();

export function registerJobs(defs: JobDef[]): void {
  for (const d of defs) {
    // erro na subida, não em produção: dois handlers com o mesmo nome fariam o
    // runner executar o errado, sem ninguém perceber
    if (registro.has(d.kind)) throw new Error(`Trabalho duplicado no registro: ${d.kind}`);
    registro.set(d.kind, d);
  }
}

export function jobDef(kind: string): JobDef | null {
  return registro.get(kind) ?? null;
}

export function listJobDefs(): JobDef[] {
  return [...registro.values()];
}

/** Só para teste: esquece o registro entre casos. */
export function _resetJobRegistry(): void {
  registro.clear();
}

/**
 * O recurso de status que a tela lê. Formato no espírito do Google AIP-151 e
 * do padrão Asynchronous Request-Reply da Microsoft: status, progresso, erro e
 * resultado no mesmo corpo, para o cliente (que é o nosso próprio front) não
 * precisar de um segundo pedido nem de redirect.
 *
 * Nunca devolve `input`: pode ser um arquivo inteiro, e quando é áudio de voz
 * é biometria.
 */
export interface JobView {
  id: string;
  tipo: string;
  titulo: string;
  status: Job["status"];
  progresso: { feito: number; total: number | null; passo: string | null };
  tentativas: number;
  maxTentativas: number;
  /** quando a próxima tentativa roda, se está esperando retentar */
  proximaTentativaEm: Date | null;
  erro: { mensagem: string; permanente: boolean } | null;
  resultado: Record<string, unknown> | null;
  cancelamentoPedido: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
  iniciadoEm: Date | null;
  finalizadoEm: Date | null;
}

export function toJobView(j: Job): JobView {
  const esperando = j.status === "pendente" && j.attempts > 0;
  return {
    id: j.id,
    tipo: j.kind,
    titulo: j.title,
    status: j.status as Job["status"],
    progresso: { feito: j.progressDone, total: j.progressTotal, passo: j.step },
    tentativas: j.attempts,
    maxTentativas: j.maxAttempts,
    proximaTentativaEm: esperando ? j.runAt : null,
    erro: j.error ? { mensagem: j.error, permanente: j.errorPermanent } : null,
    resultado: j.status === "feito" ? (j.result ?? null) : null,
    cancelamentoPedido: j.cancelRequested,
    criadoEm: j.createdAt,
    atualizadoEm: j.updatedAt,
    iniciadoEm: j.startedAt,
    finalizadoEm: j.finishedAt,
  };
}
