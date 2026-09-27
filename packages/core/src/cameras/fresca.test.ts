import { describe, expect, it } from "vitest";
import { aindaEhAgora, janelaDoQuadro, pediramEsteQuadro, ROTULO_APARELHO, ROTULO_SOB_DEMANDA } from "./fresca";
import { idadeEmSegundos } from "./query";

/**
 * A MESMA FOTO CINCO VEZES.
 *
 * Medido no banco em 27/09/2026, depois de o dono pedir cinco vezes no modo de
 * voz para a Órbita olhar a câmera do notebook: UM `camera_event` (01:55:08) e
 * CINCO chamadas de visão depois dele. A mesma imagem descrita cinco vezes em
 * 92 segundos.
 *
 * A causa era uma janela só (120 s) valendo para dois tipos de imagem muito
 * diferentes. O que este arquivo trava é a separação.
 */
describe("de quem é o quadro", () => {
  it("quadro que a Órbita mesma pediu é retrato do instante, não notícia", () => {
    expect(pediramEsteQuadro(ROTULO_SOB_DEMANDA)).toBe(true);
    expect(pediramEsteQuadro(ROTULO_APARELHO)).toBe(true);
  });

  it("evento de detector NÃO conta como pedido", () => {
    // é o que protege o Frigate: encurtar a janela dele significaria "não
    // consigo ver" numa câmera que o navegador nem tem como fotografar
    for (const label of ["person", "motion", "car", "generic"]) {
      expect(pediramEsteQuadro(label)).toBe(false);
    }
  });
});

describe("janelaDoQuadro", () => {
  it("o quadro pedido usa a janela CURTA", () => {
    // 10 s em vez de 120: a segunda pergunta tem de render um quadro novo
    expect(janelaDoQuadro(ROTULO_SOB_DEMANDA, 120, 10)).toBe(10);
    expect(janelaDoQuadro(ROTULO_APARELHO, 120, 10)).toBe(10);
  });

  it("o evento empurrado mantém a janela LONGA", () => {
    expect(janelaDoQuadro("person", 120, 10)).toBe(120);
  });

  it("o caso real: 24 s depois, o quadro pedido já venceu e o do detector não", () => {
    const idade = 24; // a segunda pergunta do dono, às 01:55:32
    expect(idade > janelaDoQuadro(ROTULO_SOB_DEMANDA, 120, 10)).toBe(true);
    expect(idade > janelaDoQuadro("person", 120, 10)).toBe(false);
  });

  it("janela curta em zero pede quadro novo TODA vez", () => {
    // quem quiser sempre a imagem do instante configura 0, e nada é reaproveitado
    expect(janelaDoQuadro(ROTULO_SOB_DEMANDA, 120, 0)).toBe(0);
  });
});

/**
 * A regra de "imagem recente".
 *
 * Sem ela, "o que você está vendo?" podia ser respondido com um quadro de
 * horas atrás, e a Órbita descreveria a cozinha de manhã como se fosse agora.
 * Descrever o passado no presente não é um detalhe: é a Órbita afirmando com
 * confiança que não tem.
 */
describe("idade de uma imagem", () => {
  const agora = new Date("2026-09-22T18:00:00.000Z");

  it("conta em segundos", () => {
    expect(idadeEmSegundos(new Date("2026-09-22T17:59:30.000Z"), agora)).toBe(30);
    expect(idadeEmSegundos(new Date("2026-09-22T17:00:00.000Z"), agora)).toBe(3600);
  });

  it("imagem do instante é idade zero", () => {
    expect(idadeEmSegundos(agora, agora)).toBe(0);
  });

  it("relógio adiantado não vira idade negativa", () => {
    // a captura vem do navegador, cujo relógio pode estar à frente do servidor
    expect(idadeEmSegundos(new Date("2026-09-22T18:00:05.000Z"), agora)).toBe(0);
  });
});

describe("aindaEhAgora", () => {
  const agora = new Date("2026-09-27T01:56:40.000Z");

  it("o caso real: o quadro de 01:55:08 já não é 'agora' às 01:56:40", () => {
    // 92 segundos depois, com a janela curta de 10 s: é o pedido de quadro novo
    // que nunca foi disparado e deixou a Órbita descrever a mesma foto
    const quadro = new Date("2026-09-27T01:55:08.000Z");
    expect(aindaEhAgora(quadro, 10, agora)).toBe(false);
    // e, com a janela longa de antes, ele ainda contava como agora: o bug
    expect(aindaEhAgora(quadro, 120, agora)).toBe(true);
  });

  it("o quadro do instante vale", () => {
    expect(aindaEhAgora(agora, 10, agora)).toBe(true);
  });

  it("a borda da janela ainda vale", () => {
    expect(aindaEhAgora(new Date(agora.getTime() - 10_000), 10, agora)).toBe(true);
    expect(aindaEhAgora(new Date(agora.getTime() - 10_001), 10, agora)).toBe(false);
  });

  it("relógio do navegador adiantado não vence um quadro que acabou de chegar", () => {
    // a captura vem do navegador: idade negativa não pode virar "vencido"
    expect(aindaEhAgora(new Date(agora.getTime() + 5_000), 10, agora)).toBe(true);
  });
});
