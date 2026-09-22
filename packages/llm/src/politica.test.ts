import { describe, it, expect, vi } from "vitest";
import type { ModelInfo } from "./catalog";

const CATALOGO: Record<string, Partial<ModelInfo>> = {
  "claude/claude-opus-5": { billing: "subscription", local: false },
  "local/llama3.2:1b": { billing: "free", local: true },
  "gateway/openai/gpt-5.1": { billing: "paid", local: false },
  "google/gemini-3.8-flash": { billing: "paid", local: false },
};

vi.mock("./catalog", async (original) => {
  const real = await original<typeof import("./catalog")>();
  return { ...real, getModelInfo: (k: string) => (CATALOGO[k] ? ({ key: k, ...CATALOGO[k] } as ModelInfo) : undefined) };
});

const { alternativas, classeDoModelo, classesPermitidas, filtrarCadeia, motivoDaFalha } = await import("./politica");

const CADEIA = ["claude/claude-opus-5", "local/llama3.2:1b", "gateway/openai/gpt-5.1", "google/gemini-3.8-flash"];

describe("classe de cobrança", () => {
  it("assinatura, local e paga são coisas diferentes", () => {
    expect(classeDoModelo({ billing: "subscription", local: false })).toBe("assinatura");
    expect(classeDoModelo({ billing: "free", local: true })).toBe("local");
    expect(classeDoModelo({ billing: "paid", local: false })).toBe("paga");
  });
});

describe("o que pode atender", () => {
  it("perguntar: SÓ o que o dono escolheu", () => {
    // é a correção do comportamento antigo: escolher assinatura e a Órbita ir
    // gastar na nuvem sozinha
    expect(classesPermitidas("assinatura", "perguntar")).toEqual(["assinatura"]);
  });

  it("perguntar: o que o dono liberou na hora entra, mesmo não sendo o preferido", () => {
    const p = classesPermitidas("assinatura", "perguntar", ["paga"]);
    expect(p).toContain("assinatura");
    expect(p).toContain("paga");
    expect(p).not.toContain("local");
  });

  it("proximo: continua caindo em tudo, como era antes", () => {
    expect(classesPermitidas("assinatura", "proximo")).toEqual(["assinatura", "local", "paga"]);
  });

  it("sem_custo: cai para o local e a assinatura, NUNCA para o que cobra", () => {
    const p = classesPermitidas("assinatura", "sem_custo");
    expect(p).toContain("local");
    expect(p).not.toContain("paga");
  });

  it("sem_custo ainda obedece a liberação explícita do dono", () => {
    expect(classesPermitidas("assinatura", "sem_custo", ["paga"])).toContain("paga");
  });
});

describe("filtro da cadeia", () => {
  it("mantém a ordem original e tira o que não é permitido", () => {
    expect(filtrarCadeia(CADEIA, ["assinatura"])).toEqual(["claude/claude-opus-5"]);
    expect(filtrarCadeia(CADEIA, ["paga"])).toEqual(["gateway/openai/gpt-5.1", "google/gemini-3.8-flash"]);
  });

  it("modelo fora do catálogo não passa por engano", () => {
    expect(filtrarCadeia(["inventado/x"], ["assinatura", "local", "paga"])).toEqual([]);
  });

  it("nada permitido devolve cadeia vazia, não a cadeia inteira", () => {
    expect(filtrarCadeia(CADEIA, [])).toEqual([]);
  });
});

describe("motivo que a pessoa entende", () => {
  it("limite na assinatura é dito como limite, não como '429'", () => {
    expect(motivoDaFalha(429, "assinatura")).toMatch(/limite/i);
    expect(motivoDaFalha(429, "assinatura")).not.toMatch(/429/);
  });
  it("sem crédito é dito como sem crédito", () => {
    expect(motivoDaFalha(402, "paga")).toMatch(/crédito/i);
  });
  it("credencial recusada cobre 401 e 403", () => {
    expect(motivoDaFalha(401, "paga")).toMatch(/credencial/i);
    expect(motivoDaFalha(403, "paga")).toMatch(/credencial/i);
  });
  it("erro do servidor vira 'fora do ar'", () => {
    expect(motivoDaFalha(503, "paga")).toMatch(/fora do ar|sobrecarregado/i);
  });
  it("local sem status aponta para o Ollama, que é a causa quase sempre", () => {
    expect(motivoDaFalha(undefined, "local")).toMatch(/ollama/i);
  });
});

describe("alternativas oferecidas", () => {
  it("não reoferece o que já falhou", () => {
    const a = alternativas(CADEIA, ["assinatura"]);
    expect(a.map((x) => x.classe)).toEqual(["local", "paga"]);
  });

  it("toda alternativa diz o que custa ANTES de a pessoa escolher", () => {
    for (const a of alternativas(CADEIA, [])) expect(a.custo.length).toBeGreaterThan(5);
    expect(alternativas(CADEIA, ["assinatura", "local"])[0].custo).toMatch(/cobra por uso/i);
  });

  it("quando não sobra nada, devolve lista vazia em vez de inventar saída", () => {
    expect(alternativas(CADEIA, ["assinatura", "local", "paga"])).toEqual([]);
  });

  it("o local avisa que é lento, porque 186 s é o que ele leva nesta máquina", () => {
    expect(alternativas(CADEIA, ["assinatura"])[0].custo).toMatch(/lento/i);
  });
});
