import { describe, it, expect } from "vitest";
import { chunkPaginas, chunkText, contarTokens } from "./chunk";

describe("contarTokens", () => {
  it("conta tokens de verdade, não caracteres", () => {
    expect(contarTokens("")).toBe(0);
    const t = contarTokens("Qual o valor da conta de energia elétrica da Enel?");
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(30);
  });
});

describe("chunkPaginas", () => {
  it("retorna vazio para páginas em branco", () => {
    expect(chunkPaginas([], { tokens: 100, overlap: 10 })).toEqual([]);
    expect(chunkPaginas(["", "   \n "], { tokens: 100, overlap: 10 })).toEqual([]);
  });

  it("guarda a página de onde o trecho veio", () => {
    const paginas = ["Primeira página falando de gatos.", "Segunda página falando de cachorros.", "Terceira página falando de pássaros."];
    const trechos = chunkPaginas(paginas, { tokens: 12, overlap: 0 });
    expect(trechos.length).toBeGreaterThan(1);
    // trecho que junta duas páginas curtas registra as duas pontas
    const cachorro = trechos.find((t) => t.content.includes("cachorros"))!;
    expect(cachorro.pageStart).toBeLessThanOrEqual(2);
    expect(cachorro.pageEnd).toBeGreaterThanOrEqual(2);
    const passaro = trechos.find((t) => t.content.includes("pássaros"))!;
    expect(passaro.pageStart).toBe(3);
    expect(passaro.pageEnd).toBe(3);
  });

  it("página longa vira vários trechos, todos apontando para ela", () => {
    const longa = "linha de conteudo do contrato. ".repeat(60);
    const trechos = chunkPaginas(["capa", longa], { tokens: 60, overlap: 10 });
    const daLonga = trechos.filter((t) => t.content.includes("contrato"));
    expect(daLonga.length).toBeGreaterThan(2);
    for (const t of daLonga) expect(t.pageEnd).toBe(2);
  });

  it("respeita o alvo de tokens", () => {
    const paginas = ["palavra ".repeat(500)];
    const trechos = chunkPaginas(paginas, { tokens: 100, overlap: 10 });
    expect(trechos.length).toBeGreaterThan(3);
    for (const t of trechos) expect(contarTokens(t.content)).toBeLessThanOrEqual(130);
  });

  it("as posições apontam para o texto de origem", () => {
    const paginas = ["Linha um sobre contrato.", "Linha dois sobre garantia de cinco anos."];
    const completo = paginas.join("\n\n");
    for (const t of chunkPaginas(paginas, { tokens: 10, overlap: 0 })) {
      expect(completo.slice(t.charStart, t.charEnd)).toBe(t.content);
    }
  });

  it("repete um pedaço entre trechos vizinhos (sobreposição)", () => {
    const texto = Array.from({ length: 60 }, (_, i) => `frase numero ${i} com algum conteudo.`).join(" ");
    const semOverlap = chunkPaginas([texto], { tokens: 80, overlap: 0 });
    const comOverlap = chunkPaginas([texto], { tokens: 80, overlap: 30 });
    const soma = (ts: { content: string }[]) => ts.reduce((s, t) => s + t.content.length, 0);
    expect(soma(comOverlap)).toBeGreaterThan(soma(semOverlap));
  });

  it("junta página curta com a seguinte em vez de criar trecho de uma linha", () => {
    const paginas = ["Capa", "Índice", "Conteúdo de verdade com várias palavras para ocupar espaço suficiente no trecho."];
    const trechos = chunkPaginas(paginas, { tokens: 200, overlap: 0 });
    expect(trechos).toHaveLength(1);
    expect(trechos[0]!.pageStart).toBe(1);
    expect(trechos[0]!.pageEnd).toBe(3);
  });

  it("sobrevive a texto sem pontuação nenhuma (extrato colado)", () => {
    const texto = "1234567890 ".repeat(400);
    const trechos = chunkPaginas([texto], { tokens: 50, overlap: 5 });
    expect(trechos.length).toBeGreaterThan(5);
    for (const t of trechos) expect(t.content.length).toBeGreaterThan(0);
  });
});

describe("chunkText", () => {
  it("mantém a assinatura antiga para texto sem páginas", () => {
    expect(chunkText("")).toEqual([]);
    const r = chunkText("um texto curto");
    expect(r).toEqual(["um texto curto"]);
  });
});
