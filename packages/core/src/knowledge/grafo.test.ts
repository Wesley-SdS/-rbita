import { describe, it, expect } from "vitest";
import { encurtar, montarGrafo, vizinhos, type LinhaDeAresta, type LinhaDeNo } from "./grafo";

/**
 * O mapa do segundo cérebro.
 *
 * O grafo antigo ligava memória com memória por similaridade. Isso responde "o
 * que se parece com o quê", que é busca, não mapa. Aqui as arestas são
 * vínculos REAIS, e o que este arquivo trava é o que só se vê desenhando:
 * linha para ponto que não existe, nó que parece importante por ligação
 * apagada, e corte que apaga o centro do mapa em vez da borda.
 */

const no = (id: string, tipo: LinhaDeNo["tipo"], rotulo = id, origemId?: string): LinhaDeNo => ({ id, tipo, rotulo, origemId, quando: "2026-09-22T10:00:00.000Z" });

describe("o rótulo do nó", () => {
  it("corta sem partir palavra no meio", () => {
    const r = encurtar("reunião semanal com o fornecedor sobre o contrato de manutenção", 30);
    expect(r.endsWith("…")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(31);
    expect(r).not.toMatch(/\s…$/);
  });

  it("texto curto passa inteiro", () => {
    expect(encurtar("assinar a carta")).toBe("assinar a carta");
  });

  it("vazio não vira ponto sem nome", () => {
    expect(encurtar("   ")).toBe("(sem título)");
  });
});

describe("as ligações do mapa", () => {
  it('"veio de" sai da própria linha, sem precisar de aresta declarada', () => {
    const g = montarGrafo([no("tarefa-1", "tarefa", "assinar", "reuniao-1"), no("reuniao-1", "reuniao", "Semanal")], []);
    expect(g.arestas).toEqual([{ origem: "tarefa-1", destino: "reuniao-1", tipo: "veio_de" }]);
  });

  it("LINHA PARA O NADA é descartada", () => {
    // a reunião foi apagada e a tarefa ficou: desenhar a linha levaria a um
    // ponto invisível no meio da tela
    const g = montarGrafo([no("tarefa-1", "tarefa", "assinar", "reuniao-apagada")], []);
    expect(g.arestas).toEqual([]);
    expect(g.nos[0]!.grau).toBe(0);
  });

  it("o grau conta só as ligações que sobraram", () => {
    const linhas = [no("a", "documento"), no("b", "conversa"), no("c", "tarefa")];
    const ligacoes: LinhaDeAresta[] = [
      { origem: "a", destino: "b", tipo: "veio_de" },
      { origem: "a", destino: "fantasma", tipo: "veio_de" },
    ];
    const g = montarGrafo(linhas, ligacoes);
    expect(g.nos.find((n) => n.id === "a")!.grau).toBe(1);
    expect(g.nos.find((n) => n.id === "c")!.grau).toBe(0);
  });

  it("aresta repetida não engorda o nó duas vezes", () => {
    const g = montarGrafo([no("a", "documento"), no("b", "conversa")], [
      { origem: "a", destino: "b", tipo: "veio_de" },
      { origem: "a", destino: "b", tipo: "veio_de" },
    ]);
    expect(g.arestas).toHaveLength(1);
    expect(g.nos.find((n) => n.id === "a")!.grau).toBe(1);
  });

  it("nó ligado a si mesmo não vira laço", () => {
    const g = montarGrafo([no("a", "documento")], [{ origem: "a", destino: "a", tipo: "parecido" }]);
    expect(g.arestas).toEqual([]);
  });

  it("similaridade é um tipo de aresta, com força", () => {
    const g = montarGrafo([no("a", "memoria"), no("b", "memoria")], [{ origem: "a", destino: "b", tipo: "parecido", forca: 0.82 }]);
    expect(g.arestas[0]).toEqual({ origem: "a", destino: "b", tipo: "parecido", forca: 0.82 });
  });

  it("nó duplicado não entra duas vezes", () => {
    const g = montarGrafo([no("a", "documento"), no("a", "documento")], []);
    expect(g.nos).toHaveLength(1);
  });
});

describe("quando não cabe tudo", () => {
  it("quem sai é o de MENOS ligação, não o mais antigo", () => {
    // cortar por data apagaria o centro do mapa: o que conecta muita coisa é
    // justamente o que faz o mapa valer
    const linhas: LinhaDeNo[] = [
      { id: "hub", tipo: "reuniao", rotulo: "hub", quando: "2020-01-01T00:00:00.000Z" },
      { id: "t1", tipo: "tarefa", rotulo: "t1", origemId: "hub", quando: "2026-09-01T00:00:00.000Z" },
      { id: "t2", tipo: "tarefa", rotulo: "t2", origemId: "hub", quando: "2026-09-02T00:00:00.000Z" },
      { id: "solto", tipo: "memoria", rotulo: "solto", quando: "2026-09-20T00:00:00.000Z" },
    ];
    const g = montarGrafo(linhas, [], { teto: 3 });
    expect(g.nos.map((n) => n.id)).toContain("hub");
    expect(g.nos.map((n) => n.id)).not.toContain("solto");
    expect(g.omitidos).toBe(1);
  });

  it("entre dois nós soltos, fica o mais novo", () => {
    const linhas: LinhaDeNo[] = [
      { id: "velho", tipo: "memoria", rotulo: "v", quando: "2020-01-01T00:00:00.000Z" },
      { id: "novo", tipo: "memoria", rotulo: "n", quando: "2026-09-22T00:00:00.000Z" },
    ];
    const g = montarGrafo(linhas, [], { teto: 1 });
    expect(g.nos[0]!.id).toBe("novo");
  });

  it("cortar nó leva junto as arestas dele", () => {
    const linhas: LinhaDeNo[] = [
      { id: "a", tipo: "documento", rotulo: "a" },
      { id: "b", tipo: "documento", rotulo: "b", origemId: "a" },
      { id: "c", tipo: "memoria", rotulo: "c", origemId: "a" },
    ];
    const g = montarGrafo(linhas, [], { teto: 2 });
    for (const ar of g.arestas) {
      expect(g.nos.some((n) => n.id === ar.origem)).toBe(true);
      expect(g.nos.some((n) => n.id === ar.destino)).toBe(true);
    }
  });

  it("dentro do teto, não omite nada", () => {
    const g = montarGrafo([no("a", "documento"), no("b", "conversa")], [], { teto: 10 });
    expect(g.omitidos).toBe(0);
    expect(g.nos).toHaveLength(2);
  });
});

describe("abrir um ponto do mapa", () => {
  it("mostra o que saiu e o que chegou, com o tipo da ligação", () => {
    const g = montarGrafo(
      [no("reuniao-1", "reuniao", "Semanal"), no("tarefa-1", "tarefa", "assinar", "reuniao-1"), no("doc-1", "documento", "resumo", "reuniao-1")],
      [],
    );
    const v = vizinhos(g, "reuniao-1");
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.sentido === "chegou" && x.tipo === "veio_de")).toBe(true);
    expect(v.map((x) => x.no.id).sort()).toEqual(["doc-1", "tarefa-1"]);
  });

  it("nó sem ligação devolve lista vazia, não erro", () => {
    const g = montarGrafo([no("solo", "memoria")], []);
    expect(vizinhos(g, "solo")).toEqual([]);
  });
});
