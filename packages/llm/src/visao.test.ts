import { describe, it, expect } from "vitest";
import { escolherProvedorDeVisao, provedoresDeVisaoEmOrdem } from "./providers";

/**
 * A ordem de quem lê a imagem.
 *
 * Existia UMA escolha, e isso bastou até a conta de um provedor esvaziar: em
 * 22/09/2026 a chave da OpenAI ficou sem crédito, a leitura tentou três vezes,
 * levou 10 s e devolveu 500 — com a chave do Gemini ao lado, configurada e
 * funcionando, sem nunca ser tentada.
 */
const TODAS = { openai: true, gemini: true, gateway: true };

describe("provedores de visão em ordem", () => {
  it("no automático, todos os que têm chave", () => {
    expect(provedoresDeVisaoEmOrdem("auto", TODAS)).toEqual(["openai", "gemini", "gateway"]);
  });

  it("provedor sem chave não entra na fila", () => {
    expect(provedoresDeVisaoEmOrdem("auto", { openai: false, gemini: true, gateway: false })).toEqual(["gemini"]);
  });

  it("a escolha explícita abre a fila, mas os outros ficam de reserva", () => {
    // é o ponto todo: escolher o Gemini não pode significar ficar sem visão
    // quando ele oscilar, havendo outras chaves configuradas
    expect(provedoresDeVisaoEmOrdem("gemini", TODAS)).toEqual(["gemini", "openai", "gateway"]);
    expect(provedoresDeVisaoEmOrdem("gateway", TODAS)).toEqual(["gateway", "openai", "gemini"]);
  });

  it("escolher um provedor SEM chave não deixa a casa cega", () => {
    expect(provedoresDeVisaoEmOrdem("openai", { openai: false, gemini: true, gateway: false })).toEqual(["gemini"]);
  });

  it("sem chave nenhuma, fila vazia (só o modelo local atende)", () => {
    expect(provedoresDeVisaoEmOrdem("auto", { openai: false, gemini: false, gateway: false })).toEqual([]);
  });

  it("a escolha de um só continua valendo para quem só quer saber QUEM atende", () => {
    // `escolherProvedorDeVisao` responde outra pergunta e não mudou
    expect(escolherProvedorDeVisao("auto", TODAS)).toBe("openai");
    expect(escolherProvedorDeVisao("gemini", TODAS)).toBe("gemini");
    expect(escolherProvedorDeVisao("openai", { openai: false, gemini: true, gateway: false })).toBeNull();
  });
});
