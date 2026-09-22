import { describe, it, expect, vi } from "vitest";
import type { ModelInfo } from "@orbita/llm";

const CATALOGO: Record<string, Partial<ModelInfo>> = {
  "gateway/openai/gpt-5.1": { provider: "gateway", costPer1kInput: 0.00125, costPer1k: 0.01 },
  "google/gemini-3.8-flash": { provider: "google", costPer1kInput: 0.0003, costPer1k: 0.0025 },
  "claude/claude-opus-5": { provider: "claude" },
  "local/qwen2.5:7b": { provider: "local", local: true },
  "groq/llama": { provider: "groq" }, // provedor que não informa preço
};

vi.mock("@orbita/llm", async (original) => {
  const real = await original<typeof import("@orbita/llm")>();
  return {
    ...real,
    getModelInfo: (key: string) => (CATALOGO[key] ? ({ key, ...CATALOGO[key] } as ModelInfo) : undefined),
  };
});

const { custoDaChamada, precoDoModelo, precoDoServico, cobrancaDoProvedor } = await import("./custo");

describe("como o provedor cobra", () => {
  it("local é local, assinatura é assinatura, o resto é por uso", () => {
    expect(cobrancaDoProvedor("local")).toBe("local");
    expect(cobrancaDoProvedor("claude")).toBe("assinatura");
    expect(cobrancaDoProvedor("gateway")).toBe("uso");
    expect(cobrancaDoProvedor("google")).toBe("uso");
  });
});

describe("custo de uma chamada", () => {
  it("cobra entrada e saída com preços diferentes", () => {
    const { preco, cobranca } = precoDoModelo("google/gemini-3.8-flash");
    // 9k de entrada a 0,0003/1k = 0,0027 · 300 de saída a 0,0025/1k = 0,00075
    const c = custoDaChamada({ unidade: "tokens", entrada: 9000, saida: 300 }, preco, cobranca);
    expect(c).toBeCloseTo(0.00345, 6);
  });

  it("a parte da entrada que veio de cache não é cobrada", () => {
    const { preco, cobranca } = precoDoModelo("google/gemini-3.8-flash");
    const cheio = custoDaChamada({ unidade: "tokens", entrada: 10000, saida: 0 }, preco, cobranca);
    const comCache = custoDaChamada({ unidade: "tokens", entrada: 10000, saida: 0, entradaCache: 8000 }, preco, cobranca);
    expect(comCache).toBeLessThan(cheio);
    expect(comCache).toBeCloseTo(0.0006, 6);
  });

  it("assinatura custa ZERO por chamada, e isso é diferente de grátis", () => {
    const { preco, cobranca } = precoDoModelo("claude/claude-opus-5");
    expect(cobranca).toBe("assinatura");
    expect(custoDaChamada({ unidade: "tokens", entrada: 500000, saida: 9000 }, preco, cobranca)).toBe(0);
  });

  it("modelo local não entra na fatura", () => {
    const { cobranca } = precoDoModelo("local/qwen2.5:7b");
    expect(cobranca).toBe("local");
  });

  it("provedor sem preço informado sai como custo zero, mas NÃO como preço conhecido", () => {
    // se isto virasse "custo zero conhecido", a tela diria que não houve gasto
    const r = precoDoModelo("groq/llama");
    expect(r.cobranca).toBe("uso");
    expect(r.precoConhecido).toBe(false);
    expect(custoDaChamada({ unidade: "tokens", entrada: 100000, saida: 5000 }, r.preco, r.cobranca)).toBe(0);
  });

  it("modelo desconhecido não derruba a conta", () => {
    const r = precoDoModelo("inventado/xyz");
    expect(() => custoDaChamada({ unidade: "tokens", entrada: 10, saida: 10 }, r.preco, r.cobranca)).not.toThrow();
  });

  it("número estranho não vira NaN nem negativo na fatura", () => {
    const { preco, cobranca } = precoDoModelo("gateway/openai/gpt-5.1");
    expect(custoDaChamada({ unidade: "tokens", entrada: -50, saida: 0 }, preco, cobranca)).toBe(0);
    expect(custoDaChamada({ unidade: "tokens", entrada: Number.NaN, saida: 0 }, preco, cobranca)).toBe(0);
  });
});

describe("serviços que não são modelo de texto", () => {
  it("transcrição cobra por segundo de áudio, não por token", () => {
    const s = precoDoServico("assemblyai");
    expect(s.unidade).toBe("segundos");
    // uma reunião de 1 hora = 3600 s
    expect(custoDaChamada({ unidade: "segundos", entrada: 3600, saida: 0 }, s.preco, s.cobranca)).toBeCloseTo(0.27, 3);
  });

  it("o que roda na máquina não entra na fatura", () => {
    for (const nome of ["whisper-local", "piper", "tesseract"]) {
      const s = precoDoServico(nome);
      expect(s.cobranca).toBe("local");
      expect(custoDaChamada({ unidade: s.unidade, entrada: 100000, saida: 0 }, s.preco, s.cobranca)).toBe(0);
    }
  });

  it("serviço desconhecido é contado por requisição, não ignorado", () => {
    expect(precoDoServico("algum-servico-novo").unidade).toBe("requisicoes");
  });
});
