import { describe, it, expect } from "vitest";
import { porDia, resumirUso, type LinhaDeUso } from "./resumo";

const l = (over: Partial<LinhaDeUso> = {}): LinhaDeUso => ({
  fluxo: "chat",
  referencia: null,
  provider: "gateway",
  modelo: "gateway/openai/gpt-5.1",
  unidade: "tokens",
  entrada: 8000,
  saida: 300,
  custoUsd: 0.01,
  cobranca: "uso",
  duracaoMs: 1500,
  erro: null,
  createdAt: "2026-09-22T12:00:00.000Z",
  ...over,
});

describe("resumo do consumo", () => {
  it("soma o total e conta as chamadas", () => {
    const r = resumirUso([l(), l({ custoUsd: 0.02 })]);
    expect(r.totalUsd).toBeCloseTo(0.03, 6);
    expect(r.chamadas).toBe(2);
  });

  it("separa o que roda sob assinatura e o que roda na máquina", () => {
    const r = resumirUso([
      l({ cobranca: "assinatura", custoUsd: 0, provider: "claude" }),
      l({ cobranca: "local", custoUsd: 0, provider: "local" }),
      l(),
    ]);
    expect(r.chamadasAssinatura).toBe(1);
    expect(r.chamadasLocais).toBe(1);
    // assinatura não entra no dinheiro, mas continua aparecendo como chamada
    expect(r.totalUsd).toBeCloseTo(0.01, 6);
  });

  it("chamada paga SEM preço informado não é confundida com chamada de graça", () => {
    // é a distinção que evita a tela dizer "não gastou nada" quando na verdade
    // ela não sabe quanto gastou
    const r = resumirUso([l({ provider: "groq", custoUsd: 0 })]);
    expect(r.chamadasSemPreco).toBe(1);
    expect(r.chamadasLocais).toBe(0);
    expect(r.chamadasAssinatura).toBe(0);
  });

  it("assinatura com custo zero NÃO conta como preço desconhecido", () => {
    const r = resumirUso([l({ cobranca: "assinatura", custoUsd: 0 })]);
    expect(r.chamadasSemPreco).toBe(0);
  });

  it("agrupa por fluxo, provedor e modelo, do mais caro para o mais barato", () => {
    const r = resumirUso([
      l({ fluxo: "rotina", custoUsd: 0.5 }),
      l({ fluxo: "chat", custoUsd: 0.1 }),
      l({ fluxo: "chat", custoUsd: 0.1 }),
    ]);
    expect(r.porFluxo.map((g) => g.chave)).toEqual(["rotina", "chat"]);
    expect(r.porFluxo[0].chamadas).toBe(1);
    expect(r.porFluxo[1].chamadas).toBe(2);
    expect(r.porFluxo[1].custoUsd).toBeCloseTo(0.2, 6);
  });

  it("empate em custo zero desempata por volume, não por acaso", () => {
    const r = resumirUso([
      l({ fluxo: "embedding", custoUsd: 0, cobranca: "local", entrada: 0, saida: 0 }),
      l({ fluxo: "tts", custoUsd: 0, cobranca: "local", entrada: 0, saida: 0 }),
      l({ fluxo: "tts", custoUsd: 0, cobranca: "local", entrada: 0, saida: 0 }),
    ]);
    expect(r.porFluxo[0].chave).toBe("tts");
  });

  it("conta a falha, que custou tempo e às vezes dinheiro", () => {
    const r = resumirUso([l({ erro: "429: limite" }), l()]);
    expect(r.falhas).toBe(1);
    expect(r.porFluxo[0].falhas).toBe(1);
  });

  it("guarda as unidades do grupo, porque segundo e token não se somam", () => {
    const r = resumirUso([l({ fluxo: "transcricao", unidade: "segundos", custoUsd: 0.27 })]);
    expect(r.porFluxo[0].unidades).toEqual(["segundos"]);
  });

  it("sem nada consumido, devolve zeros e não quebra", () => {
    const r = resumirUso([]);
    expect(r.totalUsd).toBe(0);
    expect(r.porFluxo).toEqual([]);
  });
});

describe("gasto por dia", () => {
  const hoje = new Date("2026-09-22T18:00:00.000Z");

  it("devolve TODOS os dias do período, inclusive os sem gasto", () => {
    const dias = porDia([l({ createdAt: "2026-09-22T10:00:00.000Z", custoUsd: 0.4 })], 3, hoje);
    expect(dias).toHaveLength(3);
    expect(dias.map((d) => d.dia)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    // um gráfico que pula o dia vazio mente sobre o ritmo do gasto
    expect(dias[0].custoUsd).toBe(0);
    expect(dias[2].custoUsd).toBeCloseTo(0.4, 6);
  });

  it("soma várias chamadas do mesmo dia", () => {
    const dias = porDia(
      [l({ createdAt: "2026-09-22T01:00:00.000Z", custoUsd: 0.1 }), l({ createdAt: "2026-09-22T23:00:00.000Z", custoUsd: 0.2 })],
      1,
      hoje,
    );
    expect(dias[0].chamadas).toBe(2);
    expect(dias[0].custoUsd).toBeCloseTo(0.3, 6);
  });

  it("ignora o que está fora do período pedido", () => {
    const dias = porDia([l({ createdAt: "2026-08-01T10:00:00.000Z", custoUsd: 9 })], 2, hoje);
    expect(dias.every((d) => d.custoUsd === 0)).toBe(true);
  });
});
