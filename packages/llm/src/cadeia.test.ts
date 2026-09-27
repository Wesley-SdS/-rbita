import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ModelInfo } from "./catalog";

/**
 * A CADEIA de failover e o DISJUNTOR, com o catálogo simulado.
 *
 * Arquivo separado do `failover.test.ts` porque aqui o `./catalog` é
 * substituído inteiro: os testes de lá usam o catálogo de verdade.
 *
 * O caso que deu origem a tudo isto está medido em 22/09/2026: um "oi" levou
 * 23,3 s, dos quais 16,7 s foram DUAS tentativas contra a mesma conta do
 * Claude, que estava no limite. As duas correções abaixo são as que tiram
 * esse tempo.
 */

const m = (key: string, over: Partial<ModelInfo> = {}): ModelInfo => ({
  key,
  provider: "gateway",
  id: key,
  label: key,
  tier: "medium",
  billing: "paid",
  costPer1k: 0.001,
  priceKnown: true,
  local: false,
  ...over,
});

const CATALOGO: ModelInfo[] = [
  m("claude/claude-opus-5", { provider: "claude", billing: "subscription", tier: "large" }),
  m("claude/claude-opus-4-8", { provider: "claude", billing: "subscription", tier: "large", costPer1k: 0.0005 }),
  m("gateway/openai/gpt-5.1", { provider: "gateway", tier: "large" }),
  m("google/gemini-3.8-flash", { provider: "google", tier: "medium", costPer1k: 0.0003 }),
  m("local/qwen2.5:7b", { provider: "local", billing: "free", local: true, tier: "small" }),
];

// o que o teste pode mexer: o que foi descoberto e se há Ollama alcançável
const cena = { catalogo: CATALOGO, alcancavel: true };

vi.mock("./catalog", async (original) => {
  const real = await original<typeof import("./catalog")>();
  return {
    ...real,
    availableModelsSync: () => cena.catalogo,
    localAvailable: () => cena.alcancavel,
    // chave bem formada fora da descoberta ainda tem info (como o catálogo real)
    getModelInfo: (key: string) =>
      cena.catalogo.find((x) => x.key === key) ?? (key.startsWith("local/") ? m(key, { provider: "local", billing: "free", local: true }) : undefined),
  };
});

const { buildModelChain, recordProviderResult, circuitOpen, statusDoErro, configureFailover, resetBreakersForTests } = await import("./failover");
const { resetModelPolicyForTests } = await import("./policy");

// o disjuntor é estado de módulo: sem zerar, um teste abre o provedor do
// seguinte e a cadeia devolve tudo (o fallback de "todos abertos")
beforeEach(() => resetBreakersForTests());
afterEach(() => {
  configureFailover({ threshold: 3, cooldownMs: 30_000 });
  cena.catalogo = CATALOGO;
  cena.alcancavel = true;
  resetModelPolicyForTests();
});

describe("cadeia sem Ollama (PRD-SEM-OLLAMA)", () => {
  it("nada descoberto e nenhum reserva fixado: cadeia vazia, em vez de uma chave local quebrada (E1)", () => {
    cena.catalogo = [];
    expect(buildModelChain("auto")).toEqual([]);
    expect(buildModelChain("")).toEqual([]);
  });

  it("reserva fixado pelo dono ainda vale quando nada foi descoberto", () => {
    cena.catalogo = [];
    resetModelPolicyForTests({ fallbackModel: "local/qwen2.5:3b" });
    expect(buildModelChain("")).toEqual(["local/qwen2.5:3b"]);
  });

  it("sem Ollama alcançável, local não entra nem pedido, nem descoberto, nem como reserva (E4)", () => {
    cena.alcancavel = false;
    expect(buildModelChain("local/qwen2.5:7b").some((k) => k.startsWith("local/"))).toBe(false);

    cena.catalogo = [];
    resetModelPolicyForTests({ fallbackModel: "local/qwen2.5:3b" });
    expect(buildModelChain("")).toEqual([]);
  });
});

describe("cadeia de failover", () => {
  it("NÃO oferece outro modelo da mesma casa do que foi pedido", () => {
    // o bug medido: claude-opus-5 tomava 429 e a cadeia mandava claude-opus-4-8,
    // outro modelo da MESMA conta, para tomar o mesmo 429 sete segundos depois
    const cadeia = buildModelChain("claude/claude-opus-5");
    expect(cadeia[0]).toBe("claude/claude-opus-5");
    expect(cadeia.filter((k) => k.startsWith("claude/"))).toHaveLength(1);
  });

  it("dá uma alternativa por casa, para a falha de um provedor não derrubar o turno", () => {
    const casas = buildModelChain("claude/claude-opus-5").map((k) => k.split("/")[0]);
    expect(new Set(casas).size).toBe(casas.length);
    expect(casas).toContain("gateway");
    expect(casas).toContain("google");
  });

  it("modelo desconhecido não entra na cadeia, mas as alternativas continuam vindo", () => {
    const cadeia = buildModelChain("inventado/xyz");
    expect(cadeia).not.toContain("inventado/xyz");
    expect(cadeia.length).toBeGreaterThan(0);
  });
});

describe("disjuntor por provedor", () => {
  it("limite de conta (429) abre na hora, sem esperar três tentativas", () => {
    expect(circuitOpen("google")).toBe(false);
    recordProviderResult("google/gemini-3.8-flash", false, 429);
    expect(circuitOpen("google")).toBe(true);
  });

  it("chave inválida (401) e sem permissão (403) também abrem na hora", () => {
    recordProviderResult("local/qwen2.5:7b", false, 401);
    expect(circuitOpen("local")).toBe(true);
  });

  it("falha comum ainda precisa de três seguidas: uma oscilação não pune o provedor", () => {
    recordProviderResult("gateway/openai/gpt-5.1", false);
    expect(circuitOpen("gateway")).toBe(false);
    recordProviderResult("gateway/openai/gpt-5.1", false);
    expect(circuitOpen("gateway")).toBe(false);
    recordProviderResult("gateway/openai/gpt-5.1", false);
    expect(circuitOpen("gateway")).toBe(true);
  });

  it("provedor com disjuntor aberto sai da cadeia", () => {
    recordProviderResult("claude/claude-opus-5", false, 429);
    expect(buildModelChain("gateway/openai/gpt-5.1").some((k) => k.startsWith("claude/"))).toBe(false);
  });
});

describe("código HTTP escondido no erro do SDK", () => {
  it("acha o status na camada de cima", () => {
    expect(statusDoErro({ statusCode: 429 })).toBe(429);
    expect(statusDoErro({ status: 503 })).toBe(503);
  });

  it("cava as camadas que o AI SDK embrulha", () => {
    // formato real do onError do streamText
    expect(statusDoErro({ error: { lastError: { statusCode: 429 } } })).toBe(429);
    expect(statusDoErro({ cause: { error: { status: 401 } } })).toBe(401);
  });

  it("devolve indefinido quando não há status, em vez de inventar", () => {
    expect(statusDoErro(new Error("provider-error"))).toBeUndefined();
    expect(statusDoErro(null)).toBeUndefined();
    expect(statusDoErro({ statusCode: 99 })).toBeUndefined();
  });

  it("não entra em laço com erro que aponta para si mesmo", () => {
    const ciclico: Record<string, unknown> = {};
    ciclico.cause = ciclico;
    expect(statusDoErro(ciclico)).toBeUndefined();
  });
});
