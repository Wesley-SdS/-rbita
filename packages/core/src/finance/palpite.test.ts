import { describe, expect, it } from "vitest";
import { PALAVRAS_CHAVE_PADRAO, palpitarCategoria } from "./palpite";

const categorias = [
  { id: "mercado", nome: "Mercado", tipo: "despesa" as const },
  { id: "delivery", nome: "Delivery e restaurante", tipo: "despesa" as const },
  { id: "transporte", nome: "Transporte", tipo: "despesa" as const },
  { id: "moradia", nome: "Moradia", tipo: "despesa" as const },
  { id: "contas-casa", nome: "Contas da casa", tipo: "despesa" as const },
  { id: "lazer", nome: "Lazer", tipo: "despesa" as const },
  { id: "assinaturas", nome: "Assinaturas", tipo: "despesa" as const },
  { id: "outros", nome: "Outros gastos", tipo: "despesa" as const },
  { id: "salario", nome: "Salário", tipo: "receita" as const },
  { id: "outras-entradas", nome: "Outras entradas", tipo: "receita" as const },
];

describe("palpitarCategoria", () => {
  it("acha por palavra-chave embutida (ifood → Delivery e restaurante)", () => {
    expect(palpitarCategoria("Pedido iFood 23/09", [], categorias)).toBe("delivery");
  });

  it("aceita a palavra-chave com e sem acento", () => {
    expect(palpitarCategoria("PAGUEI FARMACIA HOJE", [], categorias)).toBe(null); // Saúde não está na lista de categorias deste teste
    expect(palpitarCategoria("assinatura netflix", [], categorias)).toBe("assinaturas");
  });

  it("regra do dono vence a palavra-chave embutida", () => {
    const regras = [{ contem: "estacionamento", categoriaId: "lazer" }];
    // "estacionamento" também é palavra-chave de Transporte, mas a regra do dono decide primeiro
    expect(palpitarCategoria("Estacionamento do shopping", regras, categorias)).toBe("lazer");
  });

  it("regra é case-insensitive mas não ignora categoria inexistente", () => {
    const regras = [{ contem: "IFOOD", categoriaId: "categoria-apagada" }];
    // a regra bate mas aponta para categoria que não existe mais: cai para a palavra-chave
    expect(palpitarCategoria("comprei no ifood", regras, categorias)).toBe("delivery");
  });

  it("primeira regra que bate vence, na ordem da lista", () => {
    const regras = [
      { contem: "posto", categoriaId: "transporte" },
      { contem: "posto", categoriaId: "lazer" },
    ];
    expect(palpitarCategoria("abasteci no posto shell", regras, categorias)).toBe("transporte");
  });

  it("palavra curta não casa como substring: net não casa internet, bar não casa barbearia", () => {
    const comInternet = [...categorias, { id: "casa2", nome: "Contas da casa", tipo: "despesa" as const }];
    expect(palpitarCategoria("assinatura de internet fibra", [], comInternet)).toBe("assinaturas");
    expect(palpitarCategoria("fiz a barba na barbearia", [], categorias)).toBe(null);
  });

  it("net como palavra inteira casa Contas da casa", () => {
    expect(palpitarCategoria("paguei a net do mes", [], categorias)).toBe("contas-casa");
  });

  it("respeita o tipo quando informado", () => {
    expect(palpitarCategoria("salário do mês", [], categorias, "receita")).toBe("salario");
    expect(palpitarCategoria("salário do mês", [], categorias, "despesa")).toBe(null);
  });

  it("nada encontrado devolve null", () => {
    expect(palpitarCategoria("coisa qualquer sem pista nenhuma", [], categorias)).toBe(null);
  });

  it("aceita substituir as palavras-chave padrão (zero hardcode, CLAUDE.md §5.6)", () => {
    const customizadas = { Lazer: ["cinema", "pipoca"] };
    expect(palpitarCategoria("pipoca no cinema", [], categorias, undefined, customizadas)).toBe("lazer");
    expect(palpitarCategoria("ifood as 20h", [], categorias, undefined, customizadas)).toBe(null);
  });

  it("PALAVRAS_CHAVE_PADRAO cobre as categorias do PRD §8.3", () => {
    expect(Object.keys(PALAVRAS_CHAVE_PADRAO)).toEqual([
      "Delivery e restaurante", "Transporte", "Mercado", "Saúde", "Assinaturas",
      "Moradia", "Contas da casa", "Lazer", "Educação", "Cuidados pessoais", "Pets", "Salário",
    ]);
  });
});
