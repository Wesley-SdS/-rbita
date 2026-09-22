import { describe, it, expect } from "vitest";
import { nomeDaCameraDoAparelho } from "./aparelho";

/**
 * O nome da câmera do aparelho não é enfeite: é por ele que a Órbita a
 * encontra. O `findCamera` casa por `ILIKE %texto%` no nome da câmera ou do
 * cômodo, então com o nome genérico "Câmera deste aparelho" pedir "a câmera
 * do meu notebook" não achava nada — e ela respondia que não tinha câmera,
 * tendo uma.
 */
describe("nome da câmera deste aparelho", () => {
  it("notebook e desktop viram 'notebook', que é como o dono fala", () => {
    expect(nomeDaCameraDoAparelho("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141")).toBe("Câmera do notebook");
    expect(nomeDaCameraDoAparelho("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/18")).toBe("Câmera do notebook");
  });

  it("celular vira celular", () => {
    expect(nomeDaCameraDoAparelho("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari")).toBe("Câmera do celular");
    expect(nomeDaCameraDoAparelho("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari")).toBe("Câmera do celular");
  });

  it("tablet vira tablet, e não celular", () => {
    // o iPad casa com Safari e com Mobile em vários agentes; a ordem importa
    expect(nomeDaCameraDoAparelho("Mozilla/5.0 (iPad; CPU OS 18_0) Mobile/15E148 Safari")).toBe("Câmera do tablet");
  });

  it("agente desconhecido não fica sem nome", () => {
    expect(nomeDaCameraDoAparelho("")).toBe("Câmera do notebook");
  });

  it("todo nome contém 'câmera', que é a palavra pela qual se pede", () => {
    for (const ua of ["", "iPhone", "iPad", "Windows NT"]) {
      expect(nomeDaCameraDoAparelho(ua).toLowerCase()).toContain("câmera");
    }
  });
});
