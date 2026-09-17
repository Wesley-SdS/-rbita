import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { freshness } from "./presence";

/**
 * Presença velha não é presença (decisão 9.3): a Órbita diz "visto por último"
 * em vez de afirmar onde a pessoa está agora.
 */
describe("idade do avistamento", () => {
  const agora = new Date("2026-09-17T12:00:00Z");
  const atras = (min: number) => new Date(agora.getTime() - min * 60_000);

  it("dentro da janela curta é agora", () => {
    expect(freshness(atras(0), agora, 5, 60)).toBe("agora");
    expect(freshness(atras(5), agora, 5, 60)).toBe("agora");
  });

  it("entre as duas janelas é recente", () => {
    expect(freshness(atras(6), agora, 5, 60)).toBe("recente");
    expect(freshness(atras(60), agora, 5, 60)).toBe("recente");
  });

  it("acima da janela longa é antigo", () => {
    expect(freshness(atras(61), agora, 5, 60)).toBe("antigo");
    expect(freshness(atras(60 * 24), agora, 5, 60)).toBe("antigo");
  });

  it("avistamento com relógio adiantado não quebra (conta como agora)", () => {
    expect(freshness(new Date(agora.getTime() + 60_000), agora, 5, 60)).toBe("agora");
  });
});
