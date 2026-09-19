import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os trabalhos pesados. O que está sendo provado: a reunião ENCADEIA o resumo
 * no servidor (fechar a aba não perde nada), erro que vai falhar igual de novo
 * vira permanente (não queima tentativa), e trabalho sem o anexo não roda.
 */

let transcricao: Record<string, unknown> = {};
const enfileirados: { kind: string; input?: string | null; payload?: Record<string, unknown> }[] = [];

vi.mock("./queue", async () => {
  class JobPermanentError extends Error {}
  return {
    JobPermanentError,
    enqueueJob: async (_u: string, i: { kind: string; input?: string | null; payload?: Record<string, unknown> }) => {
      enfileirados.push(i);
      return { job: { id: "resumo-1" }, jaExistia: false };
    },
  };
});
vi.mock("../meetings/transcribe", async () => {
  const real = await vi.importActual<typeof import("../meetings/transcribe")>("../meetings/transcribe");
  return { ...real, transcribeRecording: async () => transcricao };
});
vi.mock("../identity/actions", () => ({ recalcularAssinaturasDeVoz: async () => ({}), recalcularAssinaturasDeRosto: async () => ({}), ligarDesconhecidosAReuniao: async () => 0, identificarLocutoresDaReuniao: async () => [] }));
vi.mock("../meetings/summarize", () => ({ summarizeMeeting: async () => ({ summary: "ok" }) }));
vi.mock("../finance/documents", async () => {
  const real = await vi.importActual<typeof import("../finance/documents")>("../finance/documents");
  return {
    ...real,
    importReceipt: async () => {
      throw new real.DocumentoIlegivelError("Não consegui ler texto na imagem.");
    },
    importStatement: async () => ({ importados: 0, lancamentos: [] }),
  };
});
vi.mock("../rag/files", () => ({ indexFile: async () => ({}) }));
vi.mock("../rag/ingest", () => ({ ingestDocument: async () => ({ chunks: 0, documentId: null }) }));
vi.mock("../rag/reindex", () => ({ reindexarTudo: async (_u: string, modo: string) => ({ documentos: 2, trechos: 7, memorias: 1, recortados: modo === "recortar" ? 2 : 0, semTextoOriginal: 0 }) }));
vi.mock("../memory/candidates", () => ({ extrairDaConversa: async () => ({ propostos: 3, salvos: 1, pendentes: 1, descartados: 1, duplicados: 0 }) }));

import { transcreverReuniao, lerCupom, resumirReuniao, reindexarAcervo, extrairMemoria } from "./handlers";
import { JobPermanentError } from "./queue";

const ctx = (over: Partial<Parameters<typeof transcreverReuniao.run>[0]> = {}) => ({
  userId: "dono",
  jobId: "j1",
  payload: { title: "semanal", speakers: null },
  input: "data:audio/webm;base64,AAEC",
  progresso: async () => undefined,
  cancelado: async () => false,
  ...over,
});

beforeEach(() => {
  enfileirados.length = 0;
  transcricao = {
    text: "",
    provider: "assemblyai",
    utterances: [{ speaker: "A", text: "entrego na sexta", startMs: 0, endMs: 1000 }],
    speakerIdentities: [{ label: "A", unknownLabel: "Desconhecido 1" }],
  };
});

describe("reunião: transcrever e encadear o resumo", () => {
  it("com texto, enfileira o resumo no servidor e devolve o id dele", async () => {
    const r = (await transcreverReuniao.run(ctx())) as Record<string, unknown>;
    expect(r.resumoJobId).toBe("resumo-1");
    expect(enfileirados[0]).toMatchObject({ kind: "reuniao.resumir", input: "Locutor A: entrego na sexta" });
    // o "Desconhecido N" segue junto, para ser ligado ao documento da reunião
    expect(enfileirados[0]!.payload).toMatchObject({ title: "semanal", desconhecidos: ["Desconhecido 1"] });
  });

  it("transcrição vazia não gera resumo", async () => {
    transcricao = { text: "  ", provider: "whisper-local" };
    const r = (await transcreverReuniao.run(ctx())) as Record<string, unknown>;
    expect(r.resumoJobId).toBeNull();
    expect(enfileirados).toEqual([]);
  });

  it("áudio corrompido é permanente: não adianta tentar de novo", async () => {
    await expect(transcreverReuniao.run(ctx({ input: "isto não é data url" }))).rejects.toBeInstanceOf(JobPermanentError);
  });

  it("sem o anexo (já apagado) é permanente", async () => {
    await expect(transcreverReuniao.run(ctx({ input: null }))).rejects.toBeInstanceOf(JobPermanentError);
  });

  it("resumo sem transcrição no anexo é permanente", async () => {
    await expect(resumirReuniao.run(ctx({ input: "   " }))).rejects.toBeInstanceOf(JobPermanentError);
  });
});

describe("erro conhecido vira permanente", () => {
  it("cupom ilegível não volta para a fila", async () => {
    await expect(lerCupom.run(ctx({ input: "data:image/png;base64,AA" }))).rejects.toBeInstanceOf(JobPermanentError);
  });
});

describe("reindexar e aprender com a conversa", () => {
  it("reindexar recorta por padrão e devolve o que mudou", async () => {
    const r = (await reindexarAcervo.run(ctx({ payload: {} }))) as Record<string, unknown>;
    expect(r).toMatchObject({ documentos: 2, trechos: 7, recortados: 2 });
  });

  it("reindexar em modo recalcular não recorta nada", async () => {
    const r = (await reindexarAcervo.run(ctx({ payload: { modo: "recalcular" } }))) as Record<string, unknown>;
    expect(r.recortados).toBe(0);
  });

  it("extrair memória devolve o que propôs, salvou e deixou pendente", async () => {
    const r = (await extrairMemoria.run(ctx({ payload: { conversationId: "c1" } }))) as Record<string, unknown>;
    expect(r).toMatchObject({ propostos: 3, salvos: 1, pendentes: 1 });
  });

  it("extrair memória sem conversa é permanente: não adianta tentar de novo", async () => {
    await expect(extrairMemoria.run(ctx({ payload: {} }))).rejects.toBeInstanceOf(JobPermanentError);
  });
});
