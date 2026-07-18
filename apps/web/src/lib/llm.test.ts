import { describe, it, expect } from "vitest";
import { getModelInfo, availableModels, routeModelKey, AUTO_MODEL } from "@orbita/llm";

describe("catálogo de modelos", () => {
  it("resolve o modelo 'auto'", () => {
    expect(getModelInfo("auto")).toEqual(AUTO_MODEL);
  });

  it("resolve modelos locais do catálogo", () => {
    const m = getModelInfo("local/qwen2.5:7b");
    expect(m?.provider).toBe("local");
    expect(m?.billing).toBe("free");
  });

  it("esconde gateway/claude quando não configurados", () => {
    const keys = availableModels({ gateway: false, claude: false }).map((m) => m.key);
    expect(keys).toContain("auto");
    expect(keys).toContain("local/qwen2.5:7b");
    expect(keys.some((k) => k.startsWith("gateway/"))).toBe(false);
    expect(keys.some((k) => k.startsWith("claude/"))).toBe(false);
  });

  it("mostra gateway/claude quando configurados", () => {
    const keys = availableModels({ gateway: true, claude: true }).map((m) => m.key);
    expect(keys.some((k) => k.startsWith("gateway/"))).toBe(true);
    expect(keys.some((k) => k.startsWith("claude/"))).toBe(true);
  });
});

describe("auto-router", () => {
  const noExtras = { gateway: false, claude: false };

  it("mensagem simples → local pequeno", () => {
    expect(routeModelKey("oi, tudo bem?", noExtras)).toBe("local/qwen2.5:7b");
  });

  it("mensagem complexa (só local) → local grande", () => {
    expect(routeModelKey("refatore essa arquitetura de código", noExtras)).toBe("local/qwen2.5:14b");
  });

  it("mensagem complexa com Claude configurado → Claude Max", () => {
    expect(routeModelKey("prove esse teorema com uma demonstração", { gateway: false, claude: true })).toBe(
      "claude/claude-opus-4-8",
    );
  });

  it("mensagem longa é considerada complexa", () => {
    const longa = "x".repeat(700);
    expect(routeModelKey(longa, noExtras)).toBe("local/qwen2.5:14b");
  });
});
