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
    expect(matchesWake("então eu falei órbita pra ela")).toBe(true);
  });

  it("não dispara com palavras parecidas ou texto sem o gatilho", () => {
    for (const t of ["que horas são agora", "orbital", "suborbita", "abóbora", ""]) {
      expect(matchesWake(t)).toBe(false);
    }
  });
});
