import { describe, expect, it } from "vitest";
import { decidirFalha, ehTerminal, ehZumbi, intervaloDeBatimento, mensagemDeErro, proximaEspera } from "./policy";

/**
 * As decisões da fila, sem banco. As referências são River, Oban, pg-boss e o
 * artigo de backoff da AWS; o que importa provar é o que dá errado em fila de
 * verdade: espera que estoura o teto, retentar o que nunca vai dar certo, e
 * declarar morto um trabalho que está vivo.
 */

describe("espera até a próxima tentativa (full jitter)", () => {
  const base = 10_000;
  const teto = 600_000;

  it("com o sorteio no máximo, dobra a cada tentativa", () => {
    expect(proximaEspera(0, base, teto, () => 0.999999)).toBe(9_999);
    expect(proximaEspera(1, base, teto, () => 0.999999)).toBe(19_999);
    expect(proximaEspera(3, base, teto, () => 0.999999)).toBe(79_999);
  });

  it("nunca passa do teto, nem com muitas tentativas", () => {
    for (const n of [6, 10, 30, 1000]) expect(proximaEspera(n, base, teto, () => 0.999999)).toBeLessThan(teto);
  });

  it("o sorteio pode dar zero: é o que espalha as retentativas", () => {
    expect(proximaEspera(5, base, teto, () => 0)).toBe(0);
  });

  it("sem sorteio forçado fica dentro da janela", () => {
    for (let i = 0; i < 200; i++) {
      const e = proximaEspera(2, base, teto);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThan(40_000);
    }
  });
});

describe("retentar ou desistir", () => {
  it("erro permanente desiste na primeira", () => {
    expect(decidirFalha(1, 3, true)).toBe("desistir");
  });
  it("erro passageiro retenta até o limite", () => {
    expect(decidirFalha(1, 3, false)).toBe("retentar");
    expect(decidirFalha(2, 3, false)).toBe("retentar");
    expect(decidirFalha(3, 3, false)).toBe("desistir");
  });
});

describe("trabalho zumbi", () => {
  const agora = new Date("2026-09-17T12:00:00Z");
  const cincoMin = 5 * 60_000;
  const ha = (ms: number) => new Date(agora.getTime() - ms);

  it("o que este processo está rodando nunca é zumbi, mesmo com o coração velho", () => {
    // é o caso da chamada longa de LLM: nada de progresso por minutos
    expect(ehZumbi({ id: "j1", heartbeatAt: ha(60 * 60_000), startedAt: ha(60 * 60_000) }, new Set(["j1"]), cincoMin, agora)).toBe(false);
  });

  it("coração parado além do prazo é zumbi", () => {
    expect(ehZumbi({ id: "j1", heartbeatAt: ha(6 * 60_000), startedAt: ha(10 * 60_000) }, new Set(), cincoMin, agora)).toBe(true);
  });

  it("coração recente de outro processo NÃO é zumbi (tsx watch deixa dois vivos por segundos)", () => {
    expect(ehZumbi({ id: "j1", heartbeatAt: ha(10_000), startedAt: ha(10 * 60_000) }, new Set(), cincoMin, agora)).toBe(false);
  });

  it("sem coração nenhum usa o início; sem nada, é zumbi", () => {
    expect(ehZumbi({ id: "j1", heartbeatAt: null, startedAt: ha(60_000) }, new Set(), cincoMin, agora)).toBe(false);
    expect(ehZumbi({ id: "j1", heartbeatAt: null, startedAt: null }, new Set(), cincoMin, agora)).toBe(true);
  });

  it("o coração bate bem antes do prazo vencer", () => {
    expect(intervaloDeBatimento(cincoMin)).toBe(30_000);
    expect(intervaloDeBatimento(60_000)).toBe(20_000);
    expect(intervaloDeBatimento(100)).toBe(1_000);
  });
});

describe("apoio", () => {
  it("estados terminais", () => {
    expect(["feito", "falhou", "cancelado"].every(ehTerminal)).toBe(true);
    expect(["pendente", "rodando"].some(ehTerminal)).toBe(false);
  });
  it("mensagem de erro curta e nunca vazia", () => {
    expect(mensagemDeErro(new Error("   "))).toBe("Falhou sem dizer o motivo.");
    expect(mensagemDeErro("x".repeat(1000))).toHaveLength(300);
  });
});
