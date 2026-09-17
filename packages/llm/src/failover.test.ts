import { afterEach, describe, expect, it } from "vitest";
import { ordenarAlternativas } from "./failover";
import { escolherPadrao, type ModelInfo } from "./catalog";
import { fallbackModelKey, BOOTSTRAP_MODEL_KEY, configureModelPolicy, readPolicy, resetModelPolicyForTests, policySnapshot } from "./policy";

const m = (key: string, over: Partial<ModelInfo>): ModelInfo => ({
  key,
  provider: "gateway",
  id: key,
  label: key,
  tier: "medium",
  billing: "paid",
  costPer1k: 0,
  priceKnown: true,
  local: false,
  ...over,
});

const claude = m("claude/sonnet", { provider: "claude", billing: "subscription" });
const local = m("local/qwen2.5:3b", { provider: "local", billing: "free", local: true, tier: "small" });
const groqSemPreco = m("groq/llama", { provider: "groq", priceKnown: false, tier: "large" });
const gatewayBarato = m("gateway/mini", { costPer1k: 0.0006, tier: "small" });
const gatewayCaro = m("gateway/big", { costPer1k: 0.015, tier: "large" });
const todos = [groqSemPreco, gatewayCaro, local, gatewayBarato, claude];

afterEach(() => resetModelPolicyForTests());

describe("ordem do failover (RV.2)", () => {
  it("padrão: assinatura, local, paga com preço, e sem preço por último", () => {
    expect(ordenarAlternativas(todos, "assinatura_local_paga").map((x) => x.key)).toEqual([
      "claude/sonnet", "local/qwen2.5:3b", "gateway/mini", "gateway/big", "groq/llama",
    ]);
  });

  it("preço desconhecido não passa na frente do local (o bug antigo)", () => {
    const ordem = ordenarAlternativas([groqSemPreco, local], "assinatura_local_paga").map((x) => x.key);
    expect(ordem).toEqual(["local/qwen2.5:3b", "groq/llama"]);
  });

  it("nuvem paga antes do local quando o dono escolhe", () => {
    expect(ordenarAlternativas(todos, "assinatura_paga_local").map((x) => x.key)).toEqual([
      "claude/sonnet", "gateway/mini", "gateway/big", "groq/llama", "local/qwen2.5:3b",
    ]);
  });

  it("local primeiro coloca o local até antes da assinatura", () => {
    expect(ordenarAlternativas(todos, "local_primeiro")[0].key).toBe("local/qwen2.5:3b");
  });

  it("não altera a lista de entrada", () => {
    const copia = [...todos];
    ordenarAlternativas(todos, "local_primeiro");
    expect(todos).toEqual(copia);
  });
});

describe("modelo pré-selecionado", () => {
  it("nuvem: melhor de nuvem, assinatura primeiro", () => {
    expect(escolherPadrao(todos, "nuvem")?.key).toBe("claude/sonnet");
  });

  it("local: melhor local", () => {
    expect(escolherPadrao(todos, "local")?.key).toBe("local/qwen2.5:3b");
  });

  it("local sem modelo local cai para nuvem", () => {
    expect(escolherPadrao([gatewayBarato], "local")?.key).toBe("gateway/mini");
  });

  it("lista vazia: nenhum", () => {
    expect(escolherPadrao([], "nuvem")).toBeUndefined();
  });
});

describe("política de modelos", () => {
  it("sem fonte, vale o bootstrap", async () => {
    expect(await fallbackModelKey()).toBe(BOOTSTRAP_MODEL_KEY);
  });

  it("lê as fontes e atualiza o snapshot", async () => {
    configureModelPolicy({ failoverOrder: () => "local_primeiro", fallbackModel: async () => "local/qwen2.5:3b" });
    await readPolicy();
    expect(policySnapshot().failoverOrder).toBe("local_primeiro");
    expect(await fallbackModelKey()).toBe("local/qwen2.5:3b");
  });

  it("fonte que falha mantém o último valor bom", async () => {
    configureModelPolicy({ discoveryTimeoutMs: () => 1234 });
    await readPolicy();
    configureModelPolicy({ discoveryTimeoutMs: () => Promise.reject(new Error("banco fora")) });
    expect((await readPolicy()).discoveryTimeoutMs).toBe(1234);
  });
});
