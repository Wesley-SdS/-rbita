import { describe, expect, it } from "vitest";
import { contextoDoBomDia, trabalhoDoDia } from "./bom-dia";

// a agenda do dono, como ele disse em 07/10/2026
const AGENDA = ["ter, qui: Companhia de Estágios", "seg, qua, sex: Adalink"];

describe("o trabalho de cada dia", () => {
  it("cada dia vai para o lugar certo; fim de semana não tem trabalho", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => trabalhoDoDia(AGENDA, d))).toEqual([null, "Adalink", "Companhia de Estágios", "Adalink", "Companhia de Estágios", "Adalink", null]);
  });

  it("aceita dia por extenso, com acento e separado por 'e'", () => {
    expect(trabalhoDoDia(["Terça e Quinta: Escritório"], 2)).toBe("Escritório");
    expect(trabalhoDoDia(["sábado: Feira"], 6)).toBe("Feira");
    expect(trabalhoDoDia(["sem dois pontos", ": vazio", "seg:"], 1)).toBeNull();
  });
});

describe("o contexto do bom dia", () => {
  it("manda pedir a rota do lugar do dia, e escrever para ser ouvido quando é áudio", () => {
    const c = contextoDoBomDia({ diaDaSemana: 2, dia: "2026-10-07", trabalho: "Companhia de Estágios", temTrabalhoCadastrado: true, audio: true });
    expect(c).toContain("Hoje é terça-feira, 07/10.");
    expect(c).toContain('rota de casa até "Companhia de Estágios"');
    expect(c).toContain("NOTA DE VOZ");
  });

  it("dia sem trabalho não fala de trânsito; sem agenda cadastrada, não diz nada sobre isso", () => {
    expect(contextoDoBomDia({ diaDaSemana: 0, dia: "2026-10-11", trabalho: null, temTrabalhoCadastrado: true, audio: false })).toContain("não fale de trânsito");
    const semAgenda = contextoDoBomDia({ diaDaSemana: 1, dia: "2026-10-05", trabalho: null, temTrabalhoCadastrado: false, audio: false });
    expect(semAgenda).not.toContain("trânsito");
    expect(semAgenda).not.toContain("NOTA DE VOZ");
  });
});
