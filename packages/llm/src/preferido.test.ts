import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O modelo que o dono QUER de cada provedor (`llm.modelosPreferidos`).
 * Pedido em 27/09/2026: "a Órbita deve rodar na assinatura, Sonnet 5". Sem a
 * preferência, a cadeia pegava o mais forte de cada provedor (o Opus): mais
 * lento no WhatsApp e na voz, e gastando a cota da assinatura mais depressa.
 */
const descobertos = [
  { key: "claude/claude-opus-5-5", provider: "claude", id: "claude-opus-5-5", label: "Opus 5.5", local: false, tier: "large", billing: "subscription", supportsTools: true },
  { key: "claude/claude-sonnet-5", provider: "claude", id: "claude-sonnet-5", label: "Sonnet 5", local: false, tier: "medium", billing: "subscription", supportsTools: true },
  { key: "gateway/gpt-6", provider: "gateway", id: "gpt-6", label: "GPT-6", local: false, tier: "large", billing: "paid", costPer1k: 0.01, priceKnown: true, supportsTools: true },
];
vi.mock("./discovery", async () => {
  const real = await vi.importActual<typeof import("./discovery")>("./discovery");
  return { ...real, discoveredSnapshot: () => descobertos };
});

const { buildModelChain, cadeiaDaCasa, circuitOpen, modeloEmPausa, recordProviderResult, resetBreakersForTests } = await import("./failover");
const { classificarComplexidade, routeModelKey } = await import("./catalog");
const { resetModelPolicyForTests } = await import("./policy");

beforeEach(() => resetBreakersForTests());

describe("modelo preferido por provedor", () => {
  it("sem preferência: o mais forte da assinatura (Opus)", () => {
    resetModelPolicyForTests();
    expect(cadeiaDaCasa()[0]).toBe("claude/claude-opus-5-5");
  });

  it("com o Sonnet 5 preferido: ele abre a cadeia, e o outro provedor continua de reserva", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"] });
    expect(cadeiaDaCasa()).toEqual(["claude/claude-sonnet-5", "gateway/gpt-6"]);
  });

  it("o 'auto' do chat também respeita a preferência (antes ia ao Opus ou ao local)", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"] });
    expect(routeModelKey("me explica em detalhe a arquitetura de um sistema distribuído complexo")).toBe("claude/claude-sonnet-5");
  });

  it("com modelo para o complexo: o dia a dia no Sonnet, a análise no Opus", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"], modeloComplexo: "claude/claude-opus-5-5" });
    expect(routeModelKey("quanto está o dólar?")).toBe("claude/claude-sonnet-5");
    expect(routeModelKey("faz uma análise da minha estratégia de investimento")).toBe("claude/claude-opus-5-5");
    expect(routeModelKey("vou comparecer à reunião")).toBe("claude/claude-sonnet-5");
  });

  it("modelo do complexo fora do catálogo: fica no preferido", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"], modeloComplexo: "claude/claude-opus-9" });
    expect(routeModelKey("refatore esse código")).toBe("claude/claude-sonnet-5");
  });

  it("preferido que não existe mais (tirado do catálogo): cai no comportamento normal", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-9"] });
    expect(cadeiaDaCasa()[0]).toBe("claude/claude-opus-5-5");
  });

  it("pedido complexo no Opus que falha cai no Sonnet da MESMA assinatura, antes de outra conta", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"], modeloComplexo: "claude/claude-opus-5-5" });
    expect(buildModelChain("claude/claude-opus-5-5").slice(0, 3)).toEqual(["claude/claude-opus-5-5", "claude/claude-sonnet-5", "gateway/gpt-6"]);
  });

  it("429 do Opus pausa SÓ o Opus: o Sonnet segue respondendo o dia a dia", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-sonnet-5"], modeloComplexo: "claude/claude-opus-5-5" });
    recordProviderResult("claude/claude-opus-5-5", false, 429);
    expect(modeloEmPausa("claude/claude-opus-5-5")).toBe(true);
    expect(circuitOpen("claude")).toBe(false);
    expect(buildModelChain("claude/claude-opus-5-5")[0]).toBe("claude/claude-sonnet-5");
    // 429 do próprio preferido continua fechando o provedor (limite da conta)
    recordProviderResult("claude/claude-sonnet-5", false, 429);
    expect(circuitOpen("claude")).toBe(true);
  });

  it("dois preferidos do mesmo provedor: vale o primeiro da lista do dono", () => {
    resetModelPolicyForTests({ modelosPreferidos: ["claude/claude-opus-5-5", "claude/claude-sonnet-5"] });
    expect(cadeiaDaCasa()[0]).toBe("claude/claude-opus-5-5");
  });

  it("classificador: 'compara' e 'análises' são complexos; jantar e bolo não", () => {
    expect(classificarComplexidade("compara esses dois planos")).toBe(true);
    expect(classificarComplexidade("análises dos gastos")).toBe(true);
    expect(classificarComplexidade("me ajuda a planejar o jantar")).toBe(false);
    expect(classificarComplexidade("prove esse bolo")).toBe(false);
  });
});
