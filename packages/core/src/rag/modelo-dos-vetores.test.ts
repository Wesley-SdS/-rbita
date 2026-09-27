import { describe, expect, it, vi } from "vitest";

// o resumo é puro; o banco e o provedor só são tocados pelas outras funções
vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("@orbita/llm", () => ({ modeloDeEmbedding: async () => "google/gemini-embedding-2" }));

const { resumirVetores } = await import("./modelo-dos-vetores");

describe("resumirVetores (a tela do acervo)", () => {
  it("conta como faltando tudo que não é do modelo ativo, inclusive o sem rótulo", () => {
    const r = resumirVetores(
      [
        { modelo: "local/nomic-embed-text-v2-moe", trechos: 10, memorias: 2 },
        { modelo: "google/gemini-embedding-2", trechos: 4, memorias: 7 },
        { modelo: null, trechos: 1, memorias: 0 },
      ],
      "google/gemini-embedding-2",
    );
    expect(r.faltamReindexar).toBe(13);
    // o modelo em uso aparece primeiro
    expect(r.porModelo[0]!.modelo).toBe("google/gemini-embedding-2");
  });

  it("acervo todo no modelo ativo: nada falta", () => {
    expect(resumirVetores([{ modelo: "google/gemini-embedding-2", trechos: 3, memorias: 1 }], "google/gemini-embedding-2").faltamReindexar).toBe(0);
  });

  it("sem modelo ativo (nuvem pedida sem chave), nenhum vetor é pesquisável", () => {
    expect(resumirVetores([{ modelo: "google/gemini-embedding-2", trechos: 3, memorias: 1 }], null).faltamReindexar).toBe(4);
  });
});
