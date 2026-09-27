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

/**
 * A ASSINATURA entrando na visão.
 *
 * Relatado pelo dono em 27/09/2026: "estou usando assinatura, e assinatura usa
 * o Opus, e Opus é visão". Estava certo, e a assinatura não estava na lista:
 * "ver pela câmera" ia para um provedor PAGO tendo a assinatura ao lado, de
 * graça. Quem escolhe assinatura escolhe para tudo que é IA de uso geral, não
 * só para o chat.
 */
describe("a assinatura na visão", () => {
  const COM_TUDO = { assinatura: true, openai: true, gemini: true, gateway: true };

  it("no automático, a assinatura vem PRIMEIRO", () => {
    expect(provedoresDeVisaoEmOrdem("auto", COM_TUDO)[0]).toBe("assinatura");
    expect(escolherProvedorDeVisao("auto", COM_TUDO)).toBe("assinatura");
  });

  it("sem assinatura, a ordem antiga continua valendo", () => {
    const sem = { assinatura: false, openai: true, gemini: true, gateway: true };
    expect(provedoresDeVisaoEmOrdem("auto", sem)).toEqual(["openai", "gemini", "gateway"]);
  });

  it("escolher a assinatura na tela abre a fila, e os pagos ficam de reserva", () => {
    // ficar sem visão porque a assinatura bateu no limite é pior do que usar
    // uma chave paga que existe
    expect(provedoresDeVisaoEmOrdem("assinatura", COM_TUDO)).toEqual(["assinatura", "openai", "gemini", "gateway"]);
  });

  it("escolher um provedor pago NÃO coloca a assinatura na frente", () => {
    // o dono pediu aquele: respeitar o pedido é mais importante que economizar
    expect(provedoresDeVisaoEmOrdem("gemini", COM_TUDO)[0]).toBe("gemini");
  });

  it("só a assinatura configurada basta para ter visão", () => {
    const so = { assinatura: true, openai: false, gemini: false, gateway: false };
    expect(provedoresDeVisaoEmOrdem("auto", so)).toEqual(["assinatura"]);
  });
});
