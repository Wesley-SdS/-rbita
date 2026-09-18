import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { ehComandoDaCasa, montarVocabulario } from "./fast-path";

/**
 * Caminho rápido para comando da casa. Errar para o lado do caminho normal só
 * deixa mais lento; errar para o outro tira contexto de uma conversa. Por isso
 * os casos negativos importam tanto quanto os positivos.
 */

// o vocabulário real vem das keywords das tools; aqui, uma amostra fiel
const tools = [
  { domain: "casa", risk: "escrita", keywords: ["liga", "ligar", "desliga", "acende", "apaga", "ajusta"] },
  { domain: "casa", risk: "perigoso", keywords: ["destranca", "tranca", "abre", "fecha", "portão"] },
  { domain: "casa", risk: "leitura", keywords: ["luz", "luzes", "tomada", "ar condicionado", "temperatura", "aqui", "daqui"] },
  { domain: "financas", risk: "escrita", keywords: ["gasto", "liga"] },
];
const vocab = montarVocabulario(tools, ["Sala", "Quarto do casal", "Cozinha"], ["Abajur da leitura", "Ventilador"]);
const rapido = (t: string) => ehComandoDaCasa(t, vocab, 80);

describe("vai pelo caminho rápido", () => {
  it.each([
    "apaga a luz da sala",
    "Acende as luzes",
    "liga o ventilador",
    "desliga o abajur da leitura",
    "ajusta a temperatura do quarto do casal",
    "apaga a luz daqui",
    "tranca a porta da cozinha",
    "pode apagar a luz? apaga a luz",
  ])("%s", (t) => expect(rapido(t)).toBe(true));
});

describe("NÃO vai (precisa do turno completo)", () => {
  it.each([
    "liga pro João amanhã",                      // verbo sem alvo da casa
    "qual a temperatura lá fora hoje?",           // alvo sem verbo de ação
    "boa noite",
    "resume a reunião de ontem sobre a sala nova", // conversa, sem verbo
    "lembra que eu apaguei as luzes ontem",       // "apaguei" não é o verbo "apaga"
  ])("%s", (t) => expect(rapido(t)).toBe(false));

  it("mensagem longa nunca vai, mesmo sendo sobre a casa", () => {
    expect(ehComandoDaCasa("apaga a luz da sala " + "e depois me explica com calma ".repeat(5), vocab, 80)).toBe(false);
  });
});

describe("vocabulário", () => {
  it("vem só do domínio casa e separa verbo de alvo", () => {
    expect(vocab.verbos).toContain("apaga");
    expect(vocab.alvos).toContain("luz");
    expect(vocab.alvos).toContain("Cozinha");
    expect(vocab.verbos).not.toContain("gasto");
  });

  it("palavra que é verbo não serve de alvo (senão 'liga' sozinho bastaria)", () => {
    const v = montarVocabulario([{ domain: "casa", risk: "escrita", keywords: ["liga"] }, { domain: "casa", risk: "leitura", keywords: ["liga", "luz"] }], [], []);
    expect(v.alvos).not.toContain("liga");
    expect(ehComandoDaCasa("liga", v, 80)).toBe(false);
  });
});
