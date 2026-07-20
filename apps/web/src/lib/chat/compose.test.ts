import { describe, it, expect } from "vitest";
import { composeSystem, type Chunk } from "./compose";

describe("composeSystem (PromptComposer)", () => {
  it("mantém a ordem de inserção na saída, independente da prioridade", () => {
    const chunks: Chunk[] = [
      { content: "A", priority: 130 },
      { content: "B", priority: 50 },
      { content: "C", priority: 90 },
    ];
    expect(composeSystem(chunks)).toBe("ABC");
  });

  it("corta chunks compressíveis de menor prioridade quando estoura o orçamento", () => {
    // orçamento em TOKENS (~4 chars/token): núcleo=100 chars≈25 tokens,
    // RAG=300 chars≈75 tokens. Com 40 tokens o núcleo cabe e o RAG (compressível) cai.
    const chunks: Chunk[] = [
      { content: "X".repeat(100), priority: 130 }, // núcleo, nunca cortado
      { content: "RAG".repeat(100), priority: 50, compressible: true }, // cai fora
    ];
    const out = composeSystem(chunks, 40);
    expect(out.includes("X")).toBe(true);
    expect(out.includes("RAG")).toBe(false);
  });

  it("nunca corta chunks não-compressíveis mesmo acima do orçamento", () => {
    const chunks: Chunk[] = [
      { content: "SEGURANCA".repeat(50), priority: 130 },
      { content: "PERSONA".repeat(50), priority: 100 },
    ];
    const out = composeSystem(chunks, 10);
    expect(out.includes("SEGURANCA")).toBe(true);
    expect(out.includes("PERSONA")).toBe(true);
  });

  it("ignora chunks vazios", () => {
    expect(composeSystem([{ content: "", priority: 100 }, { content: "ok", priority: 90 }])).toBe("ok");
  });
});
