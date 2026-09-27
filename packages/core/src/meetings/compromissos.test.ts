import { describe, it, expect } from "vitest";
import { compromissosDoModelo, dedupeCompromissos, parsePrazo } from "./compromissos";

/**
 * O QUE O MODELO DEVOLVE, e o defeito que custou a funcionalidade inteira.
 *
 * Em 26/09/2026 o Opus extraiu os dois compromissos da reunião corretamente e
 * mandou `"prazo": null` nos dois. O schema era
 * `z.array(CompromissoSchema).max(20).catch([])`, e `z.string().optional()`
 * recusa `null` (aceita só o campo AUSENTE): a lista inteira falhava e o
 * `.catch([])` a devolvia vazia, sem log. Resumo impecável, zero compromissos,
 * zero tarefas, nenhuma pista do motivo.
 */
describe("compromissos que o modelo devolveu", () => {
  it("aceita `null` no lugar de campo ausente — era ISTO que quebrava tudo", () => {
    const { compromissos, descartados } = compromissosDoModelo([
      { descricao: "Apresentar a Órbita para o Lucas", responsavel: "Wesley", prazo: null },
      { descricao: "Apresentar o Orion para o Wesley", responsavel: "Lucas", prazo: null },
    ]);
    expect(descartados).toBe(0);
    expect(compromissos).toEqual([
      { descricao: "Apresentar a Órbita para o Lucas", responsavel: "Wesley", prazo: undefined },
      { descricao: "Apresentar o Orion para o Wesley", responsavel: "Lucas", prazo: undefined },
    ]);
  });

  it("texto vazio ou só espaço no opcional também vira ausente", () => {
    const { compromissos } = compromissosDoModelo([{ descricao: "Ligar para o cliente", responsavel: "  ", prazo: "" }]);
    expect(compromissos[0]).toEqual({ descricao: "Ligar para o cliente", responsavel: undefined, prazo: undefined });
  });

  it("um item torto derruba só ele, nunca os outros", () => {
    // antes, o item sem descrição invalidava a lista e levava os bons com ele
    const { compromissos, descartados } = compromissosDoModelo([
      { descricao: "Mandar o relatório" },
      { responsavel: "Lucas" }, // sem descrição: não dá para virar tarefa
      { descricao: "  " },
      { descricao: "Confirmar a data" },
    ]);
    expect(compromissos.map((c) => c.descricao)).toEqual(["Mandar o relatório", "Confirmar a data"]);
    expect(descartados).toBe(2);
  });

  it("um objeto solto no lugar da lista é aceito (modelo manda assim quando é só um)", () => {
    const { compromissos } = compromissosDoModelo({ descricao: "Enviar a proposta", responsavel: "Wesley" });
    expect(compromissos.map((c) => c.descricao)).toEqual(["Enviar a proposta"]);
  });

  it("campo ausente, nulo ou de outro tipo no lugar da lista não quebra", () => {
    expect(compromissosDoModelo(undefined)).toEqual({ compromissos: [], descartados: 0 });
    expect(compromissosDoModelo(null)).toEqual({ compromissos: [], descartados: 0 });
    expect(compromissosDoModelo("nenhum")).toEqual({ compromissos: [], descartados: 0 });
    expect(compromissosDoModelo([])).toEqual({ compromissos: [], descartados: 0 });
  });

  it("descrição comprida é cortada, não descartada", () => {
    // perder o compromisso por ser comprido é pior do que guardá-lo truncado
    const { compromissos, descartados } = compromissosDoModelo([{ descricao: "x".repeat(400) }]);
    expect(descartados).toBe(0);
    expect(compromissos[0]!.descricao).toHaveLength(300);
  });

  it("respeita o teto de itens por bloco", () => {
    const muitos = Array.from({ length: 40 }, (_, i) => ({ descricao: `item ${i}` }));
    expect(compromissosDoModelo(muitos).compromissos).toHaveLength(20);
  });
});

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
