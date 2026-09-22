import { describe, it, expect } from "vitest";
import { idadeEmSegundos } from "./query";

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
