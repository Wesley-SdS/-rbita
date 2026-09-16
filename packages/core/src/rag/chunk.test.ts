import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("retorna vazio para texto em branco", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("retorna um único chunk para texto curto", () => {
    const r = chunkText("um texto curto");
    expect(r).toHaveLength(1);
    expect(r[0]).toBe("um texto curto");
  });

  it("divide texto longo em múltiplos chunks", () => {
    const long = "a".repeat(2500);
    const r = chunkText(long, 1000, 150);
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it("aplica sobreposição entre chunks", () => {
    const long = "palavra ".repeat(400); // ~3200 chars
    const r = chunkText(long, 1000, 200);
    expect(r.length).toBeGreaterThan(2);
    // a soma dos tamanhos deve exceder o total por causa da sobreposição
    const soma = r.reduce((s, c) => s + c.length, 0);
    expect(soma).toBeGreaterThan(long.trim().length);
  });
});
