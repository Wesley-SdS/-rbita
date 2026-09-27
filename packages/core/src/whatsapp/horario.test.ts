import { describe, expect, it } from "vitest";
import { agoraLocal, briefingDevido, minutosDe, noSilencio } from "./horario";
import { instanteLocal } from "../fuso";

/** Tudo no fuso da CASA, não no do processo (a api pode rodar em UTC). */
const SP = "America/Sao_Paulo";

describe("agoraLocal", () => {
  it("lê o dia, a hora e o dia da semana no fuso da casa", () => {
    // 27/09/2026 (domingo) 10:30 UTC = 07:30 em São Paulo
    expect(agoraLocal(new Date("2026-09-27T10:30:00Z"), SP)).toEqual({ dia: "2026-09-27", minutos: 7 * 60 + 30, diaDaSemana: 0 });
    // 02:00 UTC de segunda ainda é domingo 23:00 em São Paulo
    expect(agoraLocal(new Date("2026-09-28T02:00:00Z"), SP)).toMatchObject({ dia: "2026-09-27", minutos: 23 * 60 });
  });
  it("fuso inválido na config não derruba o laço", () => {
    expect(agoraLocal(new Date("2026-09-27T10:30:00Z"), "Nao/Existe").dia).toBe("2026-09-27");
  });
});

describe("silêncio dos avisos", () => {
  it("faixa que atravessa a meia-noite", () => {
    expect(noSilencio("22:00-07:00", minutosDe("23:30")!)).toBe(true);
    expect(noSilencio("22:00-07:00", minutosDe("06:59")!)).toBe(true);
    expect(noSilencio("22:00-07:00", minutosDe("07:00")!)).toBe(false);
    expect(noSilencio("22:00-07:00", minutosDe("12:00")!)).toBe(false);
  });
  it("faixa no mesmo dia, vazia ou mal escrita (sem silêncio: melhor avisar)", () => {
    expect(noSilencio("13:00-14:00", minutosDe("13:30")!)).toBe(true);
    expect(noSilencio("", 600)).toBe(false);
    expect(noSilencio("22h-7h", 60)).toBe(false);
    expect(minutosDe("25:00")).toBeNull();
  });
});

describe("briefing devido", () => {
  const cfg = { ativo: true, horario: "07:00", dias: "todos" };
  const as = (hhmm: string, diaDaSemana = 1) => ({ dia: "2026-09-28", minutos: minutosDe(hhmm)!, diaDaSemana });

  it("depois do horário, uma vez por dia", () => {
    expect(briefingDevido(as("06:59"), cfg, null)).toBe(false);
    expect(briefingDevido(as("07:00"), cfg, null)).toBe(true);
    expect(briefingDevido(as("07:00"), cfg, "2026-09-28")).toBe(false);
    expect(briefingDevido(as("07:00"), cfg, "2026-09-27")).toBe(true);
  });
  it("a Órbita subiu às 8h: ainda sai; às 15h já não é briefing da manhã", () => {
    expect(briefingDevido(as("08:10"), cfg, null)).toBe(true);
    expect(briefingDevido(as("15:00"), cfg, null)).toBe(false);
  });
  it("só dias úteis e desligado", () => {
    expect(briefingDevido(as("07:05", 6), { ...cfg, dias: "uteis" }, null)).toBe(false);
    expect(briefingDevido(as("07:05", 0), { ...cfg, dias: "uteis" }, null)).toBe(false);
    expect(briefingDevido(as("07:05", 3), { ...cfg, dias: "uteis" }, null)).toBe(true);
    expect(briefingDevido(as("07:05"), { ...cfg, ativo: false }, null)).toBe(false);
    expect(briefingDevido(as("07:05"), { ...cfg, horario: "sete" }, null)).toBe(false);
  });
});

describe("instanteLocal: '15h' é 15h NA CASA", () => {
  it("sem fuso no texto: lido no fuso da casa", () => {
    expect(instanteLocal("2026-09-27T15:00", SP)!.toISOString()).toBe("2026-09-27T18:00:00.000Z");
    expect(instanteLocal("2026-09-27 08:05:30", SP)!.toISOString()).toBe("2026-09-27T11:05:30.000Z");
    expect(instanteLocal("2026-09-27T15:00", "Europe/Lisbon")!.toISOString()).toBe("2026-09-27T14:00:00.000Z");
  });
  it("fuso explícito é respeitado; lixo vira null", () => {
    expect(instanteLocal("2026-09-27T15:00:00Z", SP)!.toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(instanteLocal("2026-09-27T15:00-03:00", SP)!.toISOString()).toBe("2026-09-27T18:00:00.000Z");
    expect(instanteLocal("amanhã às 3", SP)).toBeNull();
    expect(instanteLocal("", SP)).toBeNull();
  });
});
