import { log } from "../observability/logger";
import { settings } from "../settings";
import { claimJob, failJob, finishJob, markCancelled, reportProgress, touchHeartbeat, JobPermanentError } from "./queue";
import { jobDef, type JobRunContext } from "./registry";
import { intervaloDeBatimento } from "./policy";

/**
 * O que este processo está executando AGORA. É o que impede a recuperação de
 * zumbis de pegar trabalho vivo (ver `ehZumbi`).
 */
const emExecucao = new Set<string>();
export function jobsEmExecucao(): ReadonlySet<string> {
  return emExecucao;
}

/**
 * O executor. Pega UM trabalho e roda, fora de transação. Quem chama é o laço
 * do processo persistente (apps/api), que também acorda na hora quando alguém
 * enfileira: a fila é do mesmo processo, então acordar é chamada de função.
 *
 * Um de cada vez de propósito: a máquina é CPU, e dois modelos rodando juntos
 * atrasam o chat, que é o que o dono está olhando.
 */

export type ResultadoDaVolta = "vazio" | "feito" | "falhou" | "retentar" | "cancelado" | "sem_handler";

/** Sinal de parada cooperativo: o handler enxerga pelo `cancelado()` do contexto. */
class JobCancelado extends Error {
  constructor() {
    super("cancelado pelo dono");
    this.name = "JobCancelado";
  }
}

export async function runNextJob(instanciaId: string): Promise<ResultadoDaVolta> {
  const j = await claimJob(instanciaId);
  if (!j) return "vazio";

  // pediram para parar antes mesmo de começar
  if (j.cancelRequested) {
    await markCancelled(j.id);
    return "cancelado";
  }

  const def = jobDef(j.kind);
  if (!def) {
    // handler sumiu entre enfileirar e rodar (renomeado, ou versão antiga da
    // fila): retentar não resolve
    await failJob(j, new JobPermanentError(`Não existe mais um handler para "${j.kind}".`), true);
    return "sem_handler";
  }

  const comecou = Date.now();
  emExecucao.add(j.id);
  // o coração bate num relógio próprio, não no progresso do handler: uma chamada
  // longa de LLM sem nada para relatar não pode parecer trabalho morto
  const paradoMs = (await settings.get("jobs.staleMinutes").catch(() => 5)) * 60_000;
  const coracao = setInterval(() => void touchHeartbeat(j.id).catch(() => undefined), intervaloDeBatimento(paradoMs));
  const ctx: JobRunContext = {
    userId: j.userId,
    payload: j.payload,
    input: j.input,
    jobId: j.id,
    progresso: async (feito, total, passo) => {
      const { cancelado } = await reportProgress(j.id, feito, total, passo);
      // o handler é um laço: parar aqui é parar num ponto seguro
      if (cancelado) throw new JobCancelado();
    },
    cancelado: async () => (await reportProgress(j.id, j.progressDone)).cancelado,
  };

  try {
    const resultado = await def.run(ctx);
    await finishJob(j.id, resultado ?? null);
    log.info("job.feito", { jobId: j.id, kind: j.kind, ms: Date.now() - comecou, tentativa: j.attempts });
    return "feito";
  } catch (e) {
    if (e instanceof JobCancelado) {
      await markCancelled(j.id);
      log.info("job.cancelado", { jobId: j.id, kind: j.kind, ms: Date.now() - comecou });
      return "cancelado";
    }
    return (await failJob(j, e)) === "retentar" ? "retentar" : "falhou";
  } finally {
    clearInterval(coracao);
    emExecucao.delete(j.id);
  }
}

/**
 * Uma volta do laço: esvazia o que dá, com teto por volta para não segurar o
 * processo caso alguém enfileire em rajada.
 */
export async function drainJobs(instanciaId: string, maxPorVolta = 5): Promise<number> {
  let feitos = 0;
  for (let i = 0; i < maxPorVolta; i++) {
    const r = await runNextJob(instanciaId);
    if (r === "vazio") break;
    feitos++;
  }
  return feitos;
}
