import { describe, expect, it } from "vitest";
import { matchesWake } from "./speech";

describe("matchesWake", () => {
  it("detecta as formas do gatilho", () => {
    for (const t of ["Ei Órbita", "ei orbita", "Órbita", "orbita", "EI ÓRBITA"]) {
      expect(matchesWake(t)).toBe(true);
    }
  });

  it("detecta dentro de uma frase (com pontuação)", () => {
    expect(matchesWake("ei órbita, que horas são?")).toBe(true);
    expect(matchesWake("bom dia, ei órbita")).toBe(true);
  });

  it("falar SOBRE a Órbita no meio da frase não a acorda", () => {
    // mudança deliberada: antes o nome sozinho acordava em qualquer posição, e
    // "então eu falei órbita pra ela" disparava um chamado que ninguém fez.
    // Sem prefixo, o nome só vale como chamado no COMEÇO da fala.
    expect(matchesWake("então eu falei órbita pra ela")).toBe(false);
    expect(matchesWake("a órbita da lua é elíptica")).toBe(false);
    // no começo continua acordando, que é como se chama alguém
    expect(matchesWake("órbita, tá me ouvindo?")).toBe(true);
  });

  it("não dispara com palavras parecidas ou texto sem o gatilho", () => {
    for (const t of ["que horas são agora", "orbital", "suborbita", "abóbora", ""]) {
      expect(matchesWake(t)).toBe(false);
    }
  });
});
