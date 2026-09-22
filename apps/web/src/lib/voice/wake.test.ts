import { describe, it, expect } from "vitest";
import { matchesWake } from "./speech";

/**
 * O que o navegador DEVOLVE quando alguém diz "Ei Órbita".
 *
 * O reconhecedor quase nunca entrega a grafia certa, e cada variação que falta
 * é um chamado perdido em silêncio — sem erro, sem log, sem nada explicando.
 * "em órbita" é o caso real desta casa: foi assim que a fala do dono chegou.
 */
describe("a Órbita acorda quando é chamada", () => {
  const acorda = [
    "Ei Órbita",
    "bom dia, ei órbita",   // chamado no MEIO da fala, com prefixo
    "ei orbita",
    "EI ÓRBITA",
    "em órbita",          // o caso medido aqui
    "e órbita",
    "eh orbita",
    "hey órbita",
    "Órbita",             // sem prefixo também é chamado
    "órbita, tá me ouvindo?",
    "ei, órbita",
    "ei orbitas",         // plural que o reconhecedor às vezes inventa
  ];
  for (const frase of acorda) {
    it(`acorda com "${frase}"`, () => expect(matchesWake(frase)).toBe(true));
  }
});

describe("a lista de frases é config, e é para isso que ela serve", () => {
  it("o que o reconhecedor entrega de verdade pode ser acrescentado", () => {
    // o caso real: "Oi Órbita, você tá aí?" chegou como "Oi você tá ai" — o
    // nome sumiu. Nenhum padrão casa com o que não veio; escolher a frase, sim.
    expect(matchesWake("ei orbida", ["ei orbida"])).toBe(true);
    expect(matchesWake("computador, que horas são", ["computador"])).toBe(true);
  });

  it("frase de uma palavra só vale no começo, mesmo sendo personalizada", () => {
    expect(matchesWake("falei computador pra ela", ["computador"])).toBe(false);
  });

  it("lista vazia não acorda com nada", () => {
    expect(matchesWake("ei órbita", [])).toBe(false);
  });
});

describe("a Órbita NÃO acorda sozinha", () => {
  const ignora = [
    "bom dia",
    "bom dia, a órbita da lua é elíptica",
    "vamos falar sobre o orçamento",
    "a órbita da lua",          // assunto, não chamado: o nome não está no começo
    "suborbital",               // palavra que CONTÉM o som, mas não é chamado
    "",
    "o carro é azul",
  ];
  for (const frase of ignora) {
    it(`ignora "${frase}"`, () => expect(matchesWake(frase)).toBe(false));
  }
});
