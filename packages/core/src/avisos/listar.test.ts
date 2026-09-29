import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));
const { lerConsulta } = await import("./listar");

const u = (q: string) => new URL(`http://x/api/notifications${q}`);

describe("lerConsulta", () => {
  it("sem nada: o sino de sempre (todos, 30, sem cursor)", () => {
    expect(lerConsulta(u(""))).toEqual({ ok: true, consulta: { de: "todos", naoLidas: false, limite: 30 } });
  });

  it("Rotinas: só os pedidos, não lidos, com cursor", () => {
    const r = lerConsulta(u("?de=pedidos&naoLidas=1&antes=2026-09-28T10:00:00.000Z&limite=10"));
    expect(r).toEqual({ ok: true, consulta: { de: "pedidos", naoLidas: true, antes: "2026-09-28T10:00:00.000Z", limite: 10 } });
  });

  it("limite fora da faixa e origem desconhecida caem no padrão", () => {
    expect(lerConsulta(u("?limite=5000&de=tudo"))).toMatchObject({ ok: true, consulta: { de: "todos", limite: 30 } });
  });

  it("cursor que não é data: erro, em vez de ignorar e repetir a primeira página", () => {
    expect(lerConsulta(u("?antes=ontem")).ok).toBe(false);
  });
});
