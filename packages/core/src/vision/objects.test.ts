import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { matchTrackedLabel } from "./objects";

/**
 * Memória visual (decisão 9.4): só entra o que o dono listou. O rótulo vem da
 * câmera, então precisa casar sem depender de acento, caixa ou plural.
 */
describe("objeto rastreado", () => {
  const lista = ["chave", "mochila", "óculos", "controle da TV"];

  it("casa exato, com acento e com caixa diferente", () => {
    expect(matchTrackedLabel("chave", lista)).toBe("chave");
    expect(matchTrackedLabel("OCULOS", lista)).toBe("óculos");
    expect(matchTrackedLabel("Óculos", lista)).toBe("óculos");
  });

  it("casa plural e forma mais longa da câmera", () => {
    expect(matchTrackedLabel("chaves", lista)).toBe("chave");
    expect(matchTrackedLabel("controle da TV da sala", lista)).toBe("controle da TV");
  });

  it("o que não está na lista não é guardado", () => {
    expect(matchTrackedLabel("person", lista)).toBeNull();
    expect(matchTrackedLabel("car", lista)).toBeNull();
    expect(matchTrackedLabel("", lista)).toBeNull();
  });

  it("lista vazia desliga a memória visual", () => {
    expect(matchTrackedLabel("chave", [])).toBeNull();
  });
});
