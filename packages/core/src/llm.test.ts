import { describe, it, expect } from "vitest";
import {
  getModelInfo, parseModelKey, escolherModelo, classificarComplexidade,
  AUTO_MODEL, type ModelInfo,
} from "@orbita/llm";

/**
 * O catálogo deixou de ser um array literal: os modelos são DESCOBERTOS nos
 * provedores (ollama /api/tags, anthropic /v1/models, gateway getAvailableModels).
 * Por isso estes testes não afirmam mais "o modelo X existe" — isso depende da
 * máquina. Eles cobrem o que é determinístico: parsing de chave, derivação de
 * metadados e a lógica pura de escolha.
 */

const modelo = (over: Partial<ModelInfo> & Pick<ModelInfo, "key" | "provider" | "tier" | "local">): ModelInfo => ({
  id: over.key.split("/").slice(1).join("/"),
  label: over.key,
  billing: over.local ? "free" : "paid",
  costPer1k: 0,
  ...over,
});

describe("chave de modelo", () => {
  it("separa provedor e id na primeira barra", () => {
    expect(parseModelKey("local/qwen3:8b")).toEqual({ provider: "local", id: "qwen3:8b" });
  });

  it("preserva barras dentro do id (gateway)", () => {
    expect(parseModelKey("gateway/openai/gpt-5")).toEqual({ provider: "gateway", id: "openai/gpt-5" });
  });

  it("rejeita chave sem provedor conhecido ou sem id", () => {
    expect(parseModelKey("inventado/x")).toBeNull();
    expect(parseModelKey("local/")).toBeNull();
    expect(parseModelKey("sembarra")).toBeNull();
  });
});

describe("metadados do modelo", () => {
  it("resolve o pseudo-modelo 'auto'", () => {
    expect(getModelInfo("auto")).toEqual(AUTO_MODEL);
  });

  it("deriva metadados de uma chave ainda não descoberta", () => {
    // modelo recém-instalado, cache frio: não pode ser rejeitado só por não
    // constar de um catálogo — era exatamente o comportamento hardcoded antigo.
    const m = getModelInfo("local/modelo-novo:1b");
    expect(m?.provider).toBe("local");
    expect(m?.billing).toBe("free");
    expect(m?.local).toBe(true);
  });

  it("marca assinatura para o Claude e pago para nuvem", () => {
    expect(getModelInfo("claude/claude-sonnet-5")?.billing).toBe("subscription");
    expect(getModelInfo("gateway/openai/gpt-5")?.billing).toBe("paid");
    expect(getModelInfo("gateway/openai/gpt-5")?.local).toBe(false);
  });

  it("devolve undefined para chave malformada", () => {
    expect(getModelInfo("xxx")).toBeUndefined();
  });
});

describe("classificação de complexidade", () => {
  it("saudação é simples", () => {
    expect(classificarComplexidade("oi, tudo bem?")).toBe(false);
  });

  it("pedido de código/arquitetura é complexo", () => {
    expect(classificarComplexidade("refatore essa arquitetura de código")).toBe(true);
  });

  it("texto longo é complexo", () => {
    expect(classificarComplexidade("x".repeat(700))).toBe(true);
  });
});

describe("escolha de modelo (núcleo puro do roteador)", () => {
  const lista: ModelInfo[] = [
    modelo({ key: "local/qwen3:1.7b", provider: "local", tier: "small", local: true, supportsTools: true }),
    modelo({ key: "local/qwen3:14b", provider: "local", tier: "large", local: true, supportsTools: true }),
    modelo({ key: "claude/claude-opus-5", provider: "claude", tier: "large", local: false, billing: "subscription" }),
    modelo({ key: "gateway/openai/gpt-5", provider: "gateway", tier: "large", local: false, costPer1k: 0.05 }),
  ];

  it("pedido simples vai para o local pequeno (latência)", () => {
    expect(escolherModelo(lista, { complexo: false })?.key).toBe("local/qwen3:1.7b");
  });

  it("pedido complexo prefere nuvem forte, e assinatura antes de pago", () => {
    expect(escolherModelo(lista, { complexo: true })?.key).toBe("claude/claude-opus-5");
  });

  it("sem nuvem, complexo cai no maior local", () => {
    const soLocal = lista.filter((m) => m.local);
    expect(escolherModelo(soLocal, { complexo: true })?.key).toBe("local/qwen3:14b");
  });

  it("sem local, simples usa a nuvem disponível", () => {
    const soNuvem = lista.filter((m) => !m.local);
    expect(escolherModelo(soNuvem, { complexo: false })?.key).toBeDefined();
  });

  it("ignora modelos que não sabem usar ferramentas na trilha local", () => {
    const semTools = [modelo({ key: "local/base:7b", provider: "local", tier: "small", local: true, supportsTools: false })];
    expect(escolherModelo(semTools, { complexo: false })).toBeUndefined();
  });

  it("lista vazia não escolhe nada", () => {
    expect(escolherModelo([], { complexo: false })).toBeUndefined();
    expect(escolherModelo([AUTO_MODEL], { complexo: false })).toBeUndefined();
  });
});
