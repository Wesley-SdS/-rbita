import { describe, it, expect } from "vitest";
import { rotinasDevidas, type RotinaAgendavel } from "./run";

/**
 * Quem decide se a Órbita gasta uma chamada de modelo.
 *
 * O caso que motivou estes testes está medido em 22/09/2026: com o provedor
 * fora do ar, `lastRunAt` só era gravado no sucesso, então uma rotina de hora
 * em hora voltava a ser "devida" em TODO tique e tentava a cada 70 segundos
 * por horas. A correção é gravar a tentativa, e é isto que o último teste
 * documenta: depois de tentar, a rotina não é devida de novo antes da hora.
 */
const AGORA = Date.UTC(2026, 8, 22, 12, 0, 0);
const min = (n: number) => new Date(AGORA - n * 60_000);

const r = (over: Partial<RotinaAgendavel> = {}): RotinaAgendavel => ({
  enabled: true,
  lastRunAt: null,
  intervalMinutes: 60,
  ...over,
});

describe("quais rotinas rodam agora", () => {
  it("rotina que nunca rodou é devida", () => {
    expect(rotinasDevidas([r()], AGORA)).toHaveLength(1);
  });

  it("rotina desligada nunca é devida, nem no force", () => {
    expect(rotinasDevidas([r({ enabled: false })], AGORA)).toHaveLength(0);
    expect(rotinasDevidas([r({ enabled: false })], AGORA, true)).toHaveLength(0);
  });

  it("dentro do intervalo não é devida; passado o intervalo, é", () => {
    expect(rotinasDevidas([r({ lastRunAt: min(59) })], AGORA)).toHaveLength(0);
    expect(rotinasDevidas([r({ lastRunAt: min(60) })], AGORA)).toHaveLength(1);
  });

  it("force ignora o intervalo (é o botão 'rodar agora')", () => {
    expect(rotinasDevidas([r({ lastRunAt: min(1) })], AGORA, true)).toHaveLength(1);
  });

  it("uma tentativa recente segura a próxima, mesmo que tenha falhado", () => {
    // é o que impede o laço de 70 em 70 segundos contra um provedor fora do ar
    const tentouAgoraMesmo = r({ lastRunAt: min(0), intervalMinutes: 60 });
    expect(rotinasDevidas([tentouAgoraMesmo], AGORA)).toHaveLength(0);
  });
});
