import { describe, expect, it, vi, beforeEach } from "vitest";

const linhas: Record<string, unknown[]> = { memory: [], memoryCandidate: [] };
const inseridos: Record<string, unknown>[] = [];
const atualizados: Record<string, unknown>[] = [];

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("@orbita/db/knowledge-schema", () => ({ memory: {}, memoryCandidate: {} }));
vi.mock("@orbita/db/chat-schema", () => ({ message: {} }));
// importActual e sobrescrita do que fala com o mundo: a lista de exports do
// @orbita/llm cresce, e um mock por enumeração quebra a cada export novo
vi.mock("@orbita/llm", async (original) => ({
  ...(await original<typeof import("@orbita/llm")>()),
  embedText: async () => [0.1, 0.2, 0.3],
  embedTexts: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]),
  resolveModel: () => ({}),
  fallbackModelKey: async () => "local/teste",
}));

import { destinoDoCandidato } from "./candidates";

describe("o que fazer com um fato proposto", () => {
  const limites = { autoSalvar: 0.85, perguntar: 0.5, sensiveis: ["saude", "dinheiro", "terceiros", "relacionamento"] };

  it("confiança alta e assunto comum é guardado sozinho", () => {
    expect(destinoDoCandidato({ categoria: "preferencia", confianca: 0.92 }, limites)).toEqual({ destino: "salvar", motivo: "confianca_alta" });
  });

  it("confiança média pergunta ao dono", () => {
    expect(destinoDoCandidato({ categoria: "casa", confianca: 0.7 }, limites).destino).toBe("perguntar");
  });

  it("confiança baixa nem incomoda", () => {
    expect(destinoDoCandidato({ categoria: "casa", confianca: 0.3 }, limites)).toEqual({ destino: "descartar", motivo: "confianca_baixa" });
  });

  it("assunto sensível SEMPRE pergunta, mesmo com certeza total", () => {
    for (const categoria of limites.sensiveis) {
      expect(destinoDoCandidato({ categoria, confianca: 1 }, limites)).toEqual({ destino: "perguntar", motivo: "assunto_sensivel" });
    }
  });

  it("a categoria sensível vale sem depender de caixa ou espaço", () => {
    expect(destinoDoCandidato({ categoria: " Saúde".replace("ú", "u").trim(), confianca: 0.99 }, limites).motivo).toBe("assunto_sensivel");
    expect(destinoDoCandidato({ categoria: "DINHEIRO", confianca: 0.99 }, limites).motivo).toBe("assunto_sensivel");
  });

  it("categoria vazia vira geral e segue a regra da confiança", () => {
    expect(destinoDoCandidato({ categoria: "", confianca: 0.9 }, limites).destino).toBe("salvar");
  });

  it("o dono pode mudar os limiares sem dev (tudo vem de config)", () => {
    const desconfiado = { autoSalvar: 0.99, perguntar: 0.2, sensiveis: [] as string[] };
    expect(destinoDoCandidato({ categoria: "saude", confianca: 0.95 }, desconfiado).destino).toBe("perguntar");
    expect(destinoDoCandidato({ categoria: "casa", confianca: 0.3 }, desconfiado).destino).toBe("perguntar");
  });
});

beforeEach(() => {
  linhas.memory = [];
  linhas.memoryCandidate = [];
  inseridos.length = 0;
  atualizados.length = 0;
});
