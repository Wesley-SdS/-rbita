import { describe, it, expect } from "vitest";
import { dedupeCompromissos, parsePrazo } from "./compromissos";

describe("dedupeCompromissos", () => {
  it("remove duplicata exata e por variação de caixa/acento/espaço", () => {
    const out = dedupeCompromissos([
      { descricao: "Enviar o relatório" },
      { descricao: "  ENVIAR   o relatório  " },
      { descricao: "enviar o relatorio" }, // sem acento
      { descricao: "Ligar para o cliente" },
    ]);
    expect(out.map((c) => c.descricao)).toEqual(["Enviar o relatório", "Ligar para o cliente"]);
  });

  it("ignora descrição vazia", () => {
    expect(dedupeCompromissos([{ descricao: "" }, { descricao: "  " }])).toEqual([]);
  });

  it("respeita o teto máximo", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ descricao: `item ${i}` }));
    expect(dedupeCompromissos(items, 5)).toHaveLength(5);
  });

  it("lista vazia não quebra", () => {
    expect(dedupeCompromissos([])).toEqual([]);
  });
});

describe("parsePrazo", () => {
  it("aceita ISO (YYYY-MM-DD, com ou sem hora)", () => {
    expect(parsePrazo("2026-09-20")?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(parsePrazo("2026-09-20T15:00:00")?.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("aceita dd/mm/aaaa e dd/mm/aa", () => {
    const d = parsePrazo("20/09/2026")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(20);
    expect(parsePrazo("20/09/26")!.getFullYear()).toBe(2026);
  });

  it("texto relativo ou vazio não é interpretado (evita data errada silenciosa)", () => {
    expect(parsePrazo("amanhã")).toBeNull();
    expect(parsePrazo("próxima semana")).toBeNull();
    expect(parsePrazo(undefined)).toBeNull();
    expect(parsePrazo("")).toBeNull();
    expect(parsePrazo("   ")).toBeNull();
  });

  it("data ISO absurda (ano muito no passado) é rejeitada", () => {
    expect(parsePrazo("0001-01-01", new Date("2026-01-01"))).toBeNull();
  });
});
