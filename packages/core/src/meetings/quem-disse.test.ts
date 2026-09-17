import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { parseUtterances, scoreFala, termosDe } from "./quem-disse";

/** "Quem disse que entregava na sexta?" (Onda 11): a parte pura, sem banco. */
describe("falas da transcrição", () => {
  it("lê os dois formatos de rótulo e aplica os nomes confirmados", () => {
    const texto = ["Locutor A: a gente entrega na sexta.", "B: fechado, aviso o cliente.", "Locutor A: combinado."].join("\n");
    const falas = parseUtterances(texto, { A: "Wesley", B: "Anna" });
    expect(falas).toEqual([
      { locutor: "A", nome: "Wesley", trecho: "a gente entrega na sexta." },
      { locutor: "B", nome: "Anna", trecho: "fechado, aviso o cliente." },
      { locutor: "A", nome: "Wesley", trecho: "combinado." },
    ]);
  });

  it("locutor sem nome confirmado fica sem nome, não inventa", () => {
    expect(parseUtterances("C: alguém aí?", { A: "Wesley" })[0]).toEqual({ locutor: "C", nome: null, trecho: "alguém aí?" });
    expect(parseUtterances("A: oi", null)[0]!.nome).toBeNull();
  });

  it("linha solta vira continuação da fala anterior", () => {
    const falas = parseUtterances("Locutor A: primeira parte\ne o resto da frase", { A: "Wesley" });
    expect(falas).toHaveLength(1);
    expect(falas[0]!.trecho).toBe("primeira parte e o resto da frase");
  });

  it("texto sem rótulo nenhum não vira fala", () => {
    expect(parseUtterances("resumo da reunião sem locutores", null)).toEqual([]);
  });
});

describe("relevância da fala", () => {
  it("conta quantos termos aparecem", () => {
    expect(scoreFala("a gente entrega na sexta", ["entrega", "sexta"])).toBe(2);
    expect(scoreFala("assunto diferente", ["entrega", "sexta"])).toBe(0);
  });

  it("termos ignoram acento, caixa e palavras curtas", () => {
    expect(termosDe("Entrega na SEXTA, é urgente")).toEqual(["entrega", "sexta", "urgente"]);
    expect(termosDe("de a o")).toEqual([]);
  });
});
