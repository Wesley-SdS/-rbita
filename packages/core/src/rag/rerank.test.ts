import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const cfg: Record<string, unknown> = {
  "rag.rerank": "nenhum",
  "rag.rerankModel": "",
  "rag.rerankFile": "model_quint8_avx2",
  "rag.rerankMaxChars": 1200,
  "rag.rerankTimeoutMs": 2500,
  "rag.rerankCandidates": 20,
};

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../settings", () => ({
  settings: {
    get: async (k: string) => cfg[k],
    getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])),
  },
}));

import { rerank } from "./rerank";

const hit = (id: string, sim: number) => ({ content: `trecho ${id}`, source: "doc", sim, chunkId: id });
const candidatos = [hit("a", 0.9), hit("b", 0.8), hit("c", 0.7)];

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.COHERE_API_KEY;
});
beforeEach(() => {
  cfg["rag.rerank"] = "nenhum";
  cfg["rag.rerankTimeoutMs"] = 2500;
});

describe("reordenação", () => {
  it("desligada, devolve a ordem que chegou", async () => {
    const r = await rerank("qualquer pergunta", candidatos, 2);
    expect(r.map((h) => h.chunkId)).toEqual(["a", "b"]);
  });

  it("um candidato só nem chama o modelo", async () => {
    cfg["rag.rerank"] = "cohere";
    globalThis.fetch = vi.fn(async () => new Response("não deveria ser chamado", { status: 500 })) as unknown as typeof fetch;
    const r = await rerank("pergunta", [candidatos[0]!], 5);
    expect(r).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reordena pela nota do serviço e corta no k pedido", async () => {
    cfg["rag.rerank"] = "cohere";
    process.env.COHERE_API_KEY = "chave-de-teste";
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        results: [
          { index: 2, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.4 },
          { index: 1, relevance_score: 0.1 },
        ],
      }),
    ) as unknown as typeof fetch;

    const r = await rerank("pergunta", candidatos, 2);
    expect(r.map((h) => h.chunkId)).toEqual(["c", "a"]);
    expect(r[0]!.sim).toBeCloseTo(0.99, 2);
  });

  it("serviço fora do ar não derruba o turno: vale a ordem da busca", async () => {
    cfg["rag.rerank"] = "cohere";
    process.env.COHERE_API_KEY = "chave-de-teste";
    globalThis.fetch = vi.fn(async () => new Response("erro", { status: 503 })) as unknown as typeof fetch;
    const r = await rerank("pergunta", candidatos, 3);
    expect(r.map((h) => h.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("sem chave configurada também degrada, em vez de explodir", async () => {
    cfg["rag.rerank"] = "cohere";
    const r = await rerank("pergunta", candidatos, 3);
    expect(r.map((h) => h.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("demorou mais que o teto: a ordem da busca vale", async () => {
    cfg["rag.rerank"] = "cohere";
    cfg["rag.rerankTimeoutMs"] = 20;
    process.env.COHERE_API_KEY = "chave-de-teste";
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ results: [] })), 3000)),
    ) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await rerank("pergunta", candidatos, 3);
    // o que importa: desistiu no teto em vez de esperar os 3s do serviço
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.map((h) => h.chunkId)).toEqual(["a", "b", "c"]);
  });
});
