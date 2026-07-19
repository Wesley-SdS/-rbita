import { describe, it, expect } from "vitest";
import { summarizeUsage, type UsageRow } from "./economics";

describe("summarizeUsage (economia vs nuvem)", () => {
  it("conta economia e energia para resposta local", () => {
    // 1000 tokens local pequeno (tier small ref 0.006/1k), 10s de latência.
    const rows: UsageRow[] = [{ modelKey: "local/qwen2.5:7b", tokens: 1000, latencyMs: 10_000 }];
    const s = summarizeUsage(rows);
    expect(s.localRequests).toBe(1);
    expect(s.cloudRequests).toBe(0);
    // medium tier (qwen 7b) ref 0.012 → 1000/1000 * 0.012
    expect(s.economiaBRL).toBeCloseTo(0.012, 4);
    // energia: 45W * (10000/3.6e6)h = 0.125 Wh
    expect(s.energyWhEstimate).toBeCloseTo(0.125, 2);
    expect(s.energyCostBRL).toBeGreaterThan(0);
    expect(s.liquidoBRL).toBeCloseTo(s.economiaBRL - s.energyCostBRL, 6);
  });

  it("assinatura Max gera economia mas nenhuma energia local", () => {
    const rows: UsageRow[] = [{ modelKey: "claude/claude-opus-4-8", tokens: 2000, latencyMs: 5000 }];
    const s = summarizeUsage(rows);
    // large tier ref 0.05 → 2000/1000 * 0.05 = 0.10
    expect(s.economiaBRL).toBeCloseTo(0.1, 4);
    expect(s.energyWhEstimate).toBe(0);
    expect(s.localRequests).toBe(0);
  });

  it("gateway pago vira custo, não economia", () => {
    const rows: UsageRow[] = [{ modelKey: "gateway/openai/gpt-5", tokens: 1000, latencyMs: 3000 }];
    const s = summarizeUsage(rows);
    expect(s.cloudSpentBRL).toBeCloseTo(0.05, 4); // costPer1k do catálogo
    expect(s.economiaBRL).toBe(0);
    expect(s.cloudRequests).toBe(1);
  });

  it("modelKey de visão/desconhecido é tratado como local pequeno", () => {
    const rows: UsageRow[] = [{ modelKey: "vision", tokens: 500, latencyMs: 8000 }];
    const s = summarizeUsage(rows);
    expect(s.localRequests).toBe(1);
    // small ref 0.006 → 500/1000 * 0.006 = 0.003
    expect(s.economiaBRL).toBeCloseTo(0.003, 4);
  });

  it("tokens/latência nulos não quebram o cálculo", () => {
    const rows: UsageRow[] = [{ modelKey: "local/qwen2.5:14b", tokens: null, latencyMs: null }];
    const s = summarizeUsage(rows);
    expect(s.tokensTotal).toBe(0);
    expect(s.economiaBRL).toBe(0);
    expect(s.energyWhEstimate).toBe(0);
  });
});
