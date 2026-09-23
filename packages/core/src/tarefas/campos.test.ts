import { describe, it, expect } from "vitest";
import { camposDaEdicao, dataDeVencimento, edicaoVazia } from "./campos";

describe("a data que o dono escolheu", () => {
  it("data sem hora fica no dia que foi escolhido", () => {
    // a armadilha: `new Date("2026-10-05")` é meia-noite UTC, que no Brasil é
    // dia 4 às 21h. A tarefa marcada para segunda apareceria no domingo.
    const d = dataDeVencimento("2026-10-05")!;
    expect(d.getDate()).toBe(5);
    expect(d.getMonth()).toBe(9);
    expect(d.getFullYear()).toBe(2026);
  });

  it("data com hora é respeitada como veio", () => {
    const d = dataDeVencimento("2026-10-05T08:30:00.000Z")!;
    expect(d.toISOString()).toBe("2026-10-05T08:30:00.000Z");
  });

  it("vazio, nulo e lixo não viram data", () => {
    for (const v of ["", "   ", "amanhã de manhã", "32/13/2026", null, undefined]) {
      expect(dataDeVencimento(v as string | null)).toBeNull();
    }
  });
});

describe("o que uma edição muda", () => {
  it("concluir não apaga o vencimento nem a anotação", () => {
    // o bug clássico: a tela manda só {concluida:true} e o UPDATE zera o resto
    const campos = camposDaEdicao({ concluida: true });
    expect(campos.done).toBe(true);
    expect("dueDate" in campos).toBe(false);
    expect("notes" in campos).toBe(false);
    expect("text" in campos).toBe(false);
  });

  it("nulo é o dono pedindo para limpar", () => {
    const campos = camposDaEdicao({ vencimento: null, anotacoes: null, imagemUrl: null });
    expect(campos.dueDate).toBeNull();
    expect(campos.notes).toBeNull();
    expect(campos.imageUrl).toBeNull();
  });

  it("texto e anotação chegam sem espaço sobrando", () => {
    const campos = camposDaEdicao({ texto: "  assinar a carta  ", anotacoes: "  do Cauã " });
    expect(campos.text).toBe("assinar a carta");
    expect(campos.notes).toBe("do Cauã");
  });

  it("anotação que virou só espaço é o mesmo que apagar", () => {
    expect(camposDaEdicao({ anotacoes: "   " }).notes).toBeNull();
  });

  it("pedido sem campo nenhum não é edição", () => {
    expect(edicaoVazia(camposDaEdicao({}))).toBe(true);
    expect(edicaoVazia(camposDaEdicao({ concluida: false }))).toBe(false);
  });

  it("carimba a hora da alteração", () => {
    const agora = new Date("2026-09-22T10:00:00.000Z");
    expect(camposDaEdicao({ texto: "x" }, agora).updatedAt).toBe(agora);
  });
});
