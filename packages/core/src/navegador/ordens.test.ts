import { describe, expect, it, vi } from "vitest";

/**
 * Menor da auditoria: as tools do navegador entravam no turno de uma ROTINA só
 * porque a extensão do dono estava conectada, e toda chamada falhava com "perfil
 * dedicado desligado". Agora quem decide é o Chrome de quem é o turno.
 */

const estado = { conectada: false, dedicado: false };
vi.mock("../settings", () => ({ settings: { get: async () => estado.dedicado, getMany: async () => ({}) } }));
vi.mock("./canal", () => ({ extensaoConectada: () => estado.conectada, ordemAExtensao: async () => ({}), ErroDaExtensao: class extends Error {} }));

const { atualizarDisponibilidade, navegadorDisponivel, navegadorDisponivelPara } = await import("./ordens");

describe("o Chrome de quem é o turno", () => {
  it.each([
    // [extensão conectada, perfil dedicado ligado, origem, aparece?]
    [true, false, "rotina", false],
    [true, false, "regra", false],
    [false, true, "rotina", true],
    [true, true, "rotina", true],
    [true, false, undefined, true],
    [true, false, "dono", true],
    [false, true, undefined, false],
    [false, false, undefined, false],
  ] as const)("extensão %s, dedicado %s, origem %s: %s", async (conectada, dedicado, origem, aparece) => {
    estado.conectada = conectada;
    estado.dedicado = dedicado;
    await atualizarDisponibilidade();
    expect(navegadorDisponivelPara(origem)).toBe(aparece);
    // o `requires.available` (sem saber a origem) continua o superconjunto
    expect(navegadorDisponivel()).toBe(conectada || dedicado);
  });
});
