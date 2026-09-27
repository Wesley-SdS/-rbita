import { describe, expect, it, vi } from "vitest";

/**
 * Failover depois de uma tool (auditoria do WhatsApp): recomeçar o turno em
 * outro modelo depois de um passo com tool rodaria a tool DE NOVO (gasto em
 * dobro, duas propostas na fila). Antes de qualquer tool, trocar continua valendo.
 */
const chamadas: string[] = [];
let comportamento: (modelo: string, onStepFinish: (p: { toolCalls: unknown[] }) => void) => Promise<unknown>;

vi.mock("ai", () => ({
  generateText: (o: { model: { modelId: string }; onStepFinish: (p: { toolCalls: unknown[] }) => void }) => {
    chamadas.push(o.model.modelId);
    return comportamento(o.model.modelId, o.onStepFinish);
  },
  stepCountIs: () => undefined,
}));
vi.mock("@orbita/llm", () => ({
  buildModelChain: () => [],
  cadeiaDaCasa: () => ["a/um", "b/dois"],
  fallbackModelKey: async () => "",
  recordProviderResult: vi.fn(),
  resolveModel: (k: string) => ({ modelId: k }),
  statusDoErro: () => 429,
  SEM_MODELO: "sem",
}));
vi.mock("../usage/registrar", () => ({ registrarUso: vi.fn(), FLUXO: {} }));
vi.mock("../observability/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { gerarTexto } = await import("./gerar");

describe("gerarTexto com tools", () => {
  it("falha ANTES de tool: cai para o próximo modelo", async () => {
    chamadas.length = 0;
    comportamento = async (m) => {
      if (m === "a/um") throw new Error("429");
      return { text: "ok", usage: {} };
    };
    expect((await gerarTexto({ userId: "u", fluxo: "f", prompt: "p" })).modelKey).toBe("b/dois");
    expect(chamadas).toEqual(["a/um", "b/dois"]);
  });

  it("falha DEPOIS de uma tool: não recomeça em outro modelo", async () => {
    chamadas.length = 0;
    comportamento = async (m, onStepFinish) => {
      onStepFinish({ toolCalls: [{ toolName: "registrar_gasto" }] });
      if (m === "a/um") throw new Error("429 no passo 2");
      return { text: "ok", usage: {} };
    };
    await expect(gerarTexto({ userId: "u", fluxo: "f", prompt: "p" })).rejects.toThrow("429 no passo 2");
    expect(chamadas).toEqual(["a/um"]);
  });
});
