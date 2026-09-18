import { registerJobs, type JobDef, type JobRunContext } from "./registry";
import { JobPermanentError } from "./queue";
// biometria só pela fachada: esta pasta também dispara trabalho que fala com
// nuvem (resumo, cupom), e fica dentro da cerca do NV.1
import { recalcularAssinaturasDeRosto, recalcularAssinaturasDeVoz } from "../identity/actions";
import { IdentityError } from "../identity/errors";
import { summarizeMeeting } from "../meetings/summarize";
import { importReceipt, importStatement, DocumentoIlegivelError } from "../finance/documents";
import { indexFile } from "../rag/files";
import { ingestDocument } from "../rag/ingest";

/**
 * Os trabalhos pesados da casa. Cada um é o mesmo código que antes rodava
 * dentro da rota, agora com progresso e com a regra de erro permanente: o que
 * vai falhar igual de novo (arquivo ilegível, sem consentimento, pessoa que não
 * existe) não volta para a fila.
 *
 * Importado uma vez pelo processo persistente (apps/api), como os domínios de
 * tool: nenhum handler é chamado pelo nome em outro lugar.
 */

/** Erro de domínio conhecido vira permanente; o resto (rede, serviço fora) retenta. */
async function semRetentarErroConhecido<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IdentityError || e instanceof DocumentoIlegivelError) throw new JobPermanentError(e.message);
    throw e;
  }
}

const texto = (p: Record<string, unknown>, k: string): string => (typeof p[k] === "string" ? (p[k] as string) : "");

function exigirInput(ctx: JobRunContext): string {
  if (!ctx.input) throw new JobPermanentError("O arquivo deste trabalho não está mais disponível. Envie de novo.");
  return ctx.input;
}

export const recalcularVoz: JobDef = {
  kind: "identidade.recalcular_voz",
  title: () => "Recalcular as assinaturas de voz",
  // cada amostra é uma chamada ao serviço local, que pode estar reiniciando
  maxAttempts: 3,
  run: async (ctx) => semRetentarErroConhecido(async () => ({ ...(await recalcularAssinaturasDeVoz(ctx.userId, ctx.progresso)) })),
};

export const recalcularRosto: JobDef = {
  kind: "identidade.recalcular_rosto",
  title: () => "Recalcular as assinaturas de rosto",
  maxAttempts: 3,
  run: async (ctx) => semRetentarErroConhecido(async () => ({ ...(await recalcularAssinaturasDeRosto(ctx.userId, ctx.progresso)) })),
};

export const resumirReuniao: JobDef = {
  kind: "reuniao.resumir",
  title: (p) => (texto(p, "title") ? `Resumir a reunião "${texto(p, "title")}"` : "Resumir a reunião"),
  // LLM local cai e volta; uma nova tentativa costuma bastar, três queimam CPU demais
  maxAttempts: 2,
  run: async (ctx) =>
    semRetentarErroConhecido(async () => {
      // a transcrição mora no `input`, que é apagado ao terminar: ela já fica
      // arquivada no RAG, não precisa de uma segunda cópia na fila
      const transcript = exigirInput(ctx);
      if (!transcript.trim()) throw new JobPermanentError("A transcrição chegou vazia.");
      const desconhecidos = Array.isArray(ctx.payload.desconhecidos) ? (ctx.payload.desconhecidos as unknown[]).filter((d): d is string => typeof d === "string") : [];
      const r = await summarizeMeeting(ctx.userId, { transcript, title: texto(ctx.payload, "title") || undefined, desconhecidos }, ctx.progresso);
      return { ...r };
    }),
};

export const indexarArquivo: JobDef = {
  kind: "rag.indexar_arquivo",
  title: (p) => `Indexar "${texto(p, "nome") || "arquivo"}"`,
  run: async (ctx) => semRetentarErroConhecido(async () => ({ ...(await indexFile(ctx.userId, exigirInput(ctx), texto(ctx.payload, "nome") || "arquivo", ctx.progresso)) })),
};

export const indexarTexto: JobDef = {
  kind: "rag.indexar_texto",
  title: (p) => `Indexar "${texto(p, "title") || "texto"}"`,
  run: async (ctx) =>
    semRetentarErroConhecido(async () => {
      const title = texto(ctx.payload, "title") || "texto";
      const res = await ingestDocument(ctx.userId, title, exigirInput(ctx), "text", ctx.progresso);
      if (!res.chunks) throw new JobPermanentError("Conteúdo vazio.");
      return { title, ...res };
    }),
};

export const lerCupom: JobDef = {
  kind: "financas.cupom",
  title: () => "Ler o comprovante",
  run: async (ctx) => semRetentarErroConhecido(async () => ({ ...(await importReceipt(ctx.userId, exigirInput(ctx), ctx.progresso)) })),
};

export const lerExtrato: JobDef = {
  kind: "financas.extrato",
  title: (p) => `Importar o extrato "${texto(p, "nome") || "extrato"}"`,
  run: async (ctx) => semRetentarErroConhecido(async () => ({ ...(await importStatement(ctx.userId, exigirInput(ctx), texto(ctx.payload, "nome") || "extrato", ctx.progresso)) })),
};

registerJobs([recalcularVoz, recalcularRosto, resumirReuniao, indexarArquivo, indexarTexto, lerCupom, lerExtrato]);
