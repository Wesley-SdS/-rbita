import { describe, it, expect } from "vitest";
import { linhasDaSessao } from "./sessao";
import { custoDaChamada, precoDoServico } from "./custo";

/**
 * O gasto que não aparecia.
 *
 * Em 22/09/2026 a tela de Gastos mostrava US$ 0,13 (só chat) enquanto sessões
 * de voz pelo Gemini Live aconteciam sem deixar linha nenhuma: o áudio vai do
 * navegador direto ao Google, e o servidor nunca soube que houve custo.
 */
describe("linhas de uma sessão de voz", () => {
  it("separa áudio, texto e vídeo em linhas diferentes", () => {
    const linhas = linhasDaSessao({
      provedor: "gemini",
      modelo: "gemini-3.8-live",
      audioEntrada: 1920,
      audioSaida: 640,
      textoEntrada: 6000,
      textoSaida: 80,
      videoEntrada: 30000,
    });
    expect(linhas.map((l) => l.servico)).toEqual(["gemini-live-audio", "gemini-live-texto", "gemini-live-video"]);
  });

  it("componente zerado não vira linha", () => {
    // uma conversa sem câmera não pode deixar "vídeo: US$ 0,00" na tela
    const linhas = linhasDaSessao({ provedor: "gemini", modelo: "gemini-3.8-live", audioEntrada: 100, audioSaida: 50 });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.servico).toBe("gemini-live-audio");
  });

  it("relato vazio não gera conta", () => {
    expect(linhasDaSessao({ provedor: "gemini", modelo: "gemini-3.8-live" })).toEqual([]);
  });

  it("o mini da OpenAI tem tarifa própria", () => {
    const caro = linhasDaSessao({ provedor: "openai", modelo: "gpt-realtime-2.1", audioEntrada: 600 })[0]!;
    const barato = linhasDaSessao({ provedor: "openai", modelo: "gpt-realtime-mini", audioEntrada: 600 })[0]!;
    expect(caro.servico).toBe("openai-realtime-audio");
    expect(barato.servico).toBe("openai-realtime-mini-audio");

    const preco = (s: string, c: { entrada: number }) => {
      const p = precoDoServico(s);
      return custoDaChamada({ unidade: "tokens", entrada: c.entrada, saida: 0 }, p.preco, p.cobranca);
    };
    // o mini custa menos; se um dia a tabela inverter isso, o teste avisa
    expect(preco(barato.servico, { entrada: 600 })).toBeLessThan(preco(caro.servico, { entrada: 600 }));
  });

  it("vídeo na OpenAI não vira linha (a sessão dela não aceita vídeo)", () => {
    const linhas = linhasDaSessao({ provedor: "openai", modelo: "gpt-realtime-2.1", videoEntrada: 5000 });
    expect(linhas).toEqual([]);
  });

  it("número inválido vindo do navegador não vira gasto", () => {
    // o relato vem do cliente: negativo, NaN e Infinity não podem virar conta
    const linhas = linhasDaSessao({
      provedor: "gemini",
      modelo: "gemini-3.8-live",
      audioEntrada: -500,
      audioSaida: Number.NaN,
      textoEntrada: Number.POSITIVE_INFINITY,
    });
    expect(linhas).toEqual([]);
  });

  it("transcrição ao vivo é cobrada por segundo, não por token", () => {
    const linhas = linhasDaSessao({ provedor: "gemini", modelo: "gemini-3.5-transcribe-live", segundos: 3600 });
    expect(linhas).toEqual([{ servico: "gemini-transcribe-live", consumo: { unidade: "segundos", entrada: 3600, saida: 0 } }]);
    const p = precoDoServico("gemini-transcribe-live");
    // uma hora de reunião transcrita ao vivo: ~US$ 0,54
    expect(custoDaChamada(linhas[0]!.consumo, p.preco, p.cobranca)).toBeCloseTo(0.54, 2);
  });

  it("uma hora de conversa no Gemini Live fica na casa de menos de um dólar", () => {
    // 32 tokens por segundo de áudio: 60 min de microfone + 20 min de fala dela
    const linhas = linhasDaSessao({ provedor: "gemini", modelo: "gemini-3.8-live", audioEntrada: 60 * 60 * 32, audioSaida: 20 * 60 * 32 });
    const p = precoDoServico(linhas[0]!.servico);
    const usd = custoDaChamada(linhas[0]!.consumo, p.preco, p.cobranca);
    expect(usd).toBeGreaterThan(0.5);
    expect(usd).toBeLessThan(1);
  });
});
