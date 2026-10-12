import { describe, expect, it } from "vitest";
import { casaCuringa, normalizar, padraoNegado, semBarraNoFim, SEMPRE_NEGADOS } from "./pastas";

/**
 * O curinga dos negados e da busca sem regex (G2 da auditoria): o mesmo
 * resultado da regex antiga (`*` vira "qualquer coisa sem barra", `?` um
 * caractere) e tempo que não explode com muitos `*`.
 */

describe("casaCuringa", () => {
  it.each([
    ["nota.txt", "*.txt", true],
    ["nota.txt", "nota?txt", true],
    ["nota.txt", "*.pdf", false],
    [".env", ".env", true],
    [".env.local", ".env.*", true],
    [".env", ".env.*", false],
    ["id_rsa.key", "*.key", true],
    ["abc", "a*c", true],
    ["abc", "a*b", false],
    ["", "*", true],
    ["", "?", false],
    ["aaab", "*a*b", true],
  ])("%s com %s: %s", (texto, padrao, esperado) => {
    expect(casaCuringa(texto, padrao)).toBe(esperado);
  });

  it("muitos curingas contra um texto comprido saem na hora", () => {
    const inicio = Date.now();
    expect(casaCuringa("a".repeat(5000), `${"*a".repeat(40)}*b`)).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(500);
  });
});

describe("padraoNegado", () => {
  it("os de sempre e o padrão com barra, como antes", () => {
    expect(padraoNegado("C:\\Users\\dono\\Documents\\github\\orbita\\.env", SEMPRE_NEGADOS)).toBe(".env");
    expect(padraoNegado("C:\\x\\.env.local", SEMPRE_NEGADOS)).toBe(".env.*");
    expect(padraoNegado("C:\\Users\\dono\\.ssh\\config", SEMPRE_NEGADOS)).toBe(".ssh");
    expect(padraoNegado("C:\\x\\README.md", SEMPRE_NEGADOS)).toBeNull();
    const chrome = ["*/Google/Chrome/User Data"];
    expect(padraoNegado("C:\\Users\\dono\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies", chrome)).toBe(chrome[0]);
    expect(padraoNegado("C:\\Users\\dono\\AppData\\Local\\Google\\Chrome\\Outra", chrome)).toBeNull();
  });

  it("caminho com milhares de barras no fim não trava", () => {
    const inicio = Date.now();
    expect(padraoNegado(`C:\\x${"\\".repeat(50_000)}y`, SEMPRE_NEGADOS)).toBeNull();
    expect(semBarraNoFim(`C:\\x${"/".repeat(50_000)}`)).toBe("C:\\x");
    expect(normalizar("C:\\x\\")).toBe("c:\\x");
    expect(Date.now() - inicio).toBeLessThan(500);
  });
});
