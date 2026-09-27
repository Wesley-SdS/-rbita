import { describe, expect, it } from "vitest";
import { interpretarDitado, type ContextoDitado } from "./ditado";

const HOJE = "2026-09-27";

const categorias: ContextoDitado["categorias"] = [
  { id: "mercado", nome: "Mercado", tipo: "despesa" },
  { id: "delivery", nome: "Delivery e restaurante", tipo: "despesa" },
  { id: "transporte", nome: "Transporte", tipo: "despesa" },
  { id: "moradia", nome: "Moradia", tipo: "despesa" },
  { id: "contas-casa", nome: "Contas da casa", tipo: "despesa" },
  { id: "saude", nome: "Saúde", tipo: "despesa" },
  { id: "assinaturas", nome: "Assinaturas", tipo: "despesa" },
  { id: "lazer", nome: "Lazer", tipo: "despesa" },
  { id: "compras", nome: "Compras", tipo: "despesa" },
  { id: "educacao", nome: "Educação", tipo: "despesa" },
  { id: "cuidados", nome: "Cuidados pessoais", tipo: "despesa" },
  { id: "pets", nome: "Pets", tipo: "despesa" },
  { id: "dividas", nome: "Dívidas e juros", tipo: "despesa" },
  { id: "outros-gastos", nome: "Outros gastos", tipo: "despesa" },
  { id: "salario", nome: "Salário", tipo: "receita" },
  { id: "freelance", nome: "Freelance", tipo: "receita" },
  { id: "reembolso", nome: "Reembolso", tipo: "receita" },
  { id: "outras-entradas", nome: "Outras entradas", tipo: "receita" },
];

const ctxBase: ContextoDitado = {
  hoje: HOJE,
  contas: [
    { id: "conta-corrente", nome: "Conta corrente" },
    { id: "dinheiro", nome: "Dinheiro" },
  ],
  cartoes: [{ id: "nubank", nome: "Nubank" }],
  categorias,
  regras: [],
};

describe("interpretarDitado · critério de aceite 14.7", () => {
  it('"gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel" vira duas propostas', () => {
    const propostas = interpretarDitado("gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel", ctxBase);
    expect(propostas).toHaveLength(2);

    const [p1, p2] = propostas;
    expect(p1).toMatchObject({ tipo: "despesa", valor: 4590, data: HOJE, categoriaId: "mercado", descricao: "Mercado" });
    expect(p2).toMatchObject({ tipo: "despesa", valor: 120000, data: HOJE, categoriaId: "moradia", descricao: "Aluguel" });
  });

  it('"comprei geladeira de 3 mil em 10x no nubank" vira despesa parcelada no cartão', () => {
    const [p] = interpretarDitado("comprei geladeira de 3 mil em 10x no nubank", ctxBase);
    expect(p).toMatchObject({ tipo: "despesa", valor: 300000, parcelas: 10, cartaoId: "nubank", contaId: null });
  });

  it('"recebi 2 mil de freelance ontem" vira receita de ontem', () => {
    const [p] = interpretarDitado("recebi 2 mil de freelance ontem", ctxBase);
    expect(p).toMatchObject({ tipo: "receita", valor: 200000, categoriaId: "freelance", data: "2026-09-26" });
  });

  it('"saquei 200" vira transferência', () => {
    const [p] = interpretarDitado("saquei 200", ctxBase);
    expect(p).toMatchObject({ tipo: "transferencia", valor: 20000, origemId: "conta-corrente", destinoId: "dinheiro" });
  });

  it('"estornaram 50 do ifood" vira receita de estorno com categoria por palpite', () => {
    const [p] = interpretarDitado("estornaram 50 do ifood", ctxBase);
    expect(p).toMatchObject({ tipo: "receita", estorno: true, valor: 5000, categoriaId: "delivery" });
  });
});

describe("interpretarDitado · outros comportamentos do §8.1.3", () => {
  it("frase sem valor é ignorada", () => {
    expect(interpretarDitado("fui ao mercado", ctxBase)).toEqual([]);
  });

  it("quebra por ponto e vírgula e por ponto final, sem quebrar número com ponto de milhar", () => {
    const propostas = interpretarDitado("gastei 1.200 no mercado; recebi 50 de reembolso.", ctxBase);
    expect(propostas).toHaveLength(2);
    expect(propostas[0]).toMatchObject({ valor: 120000 });
    expect(propostas[1]).toMatchObject({ valor: 5000, tipo: "receita" });
  });

  it('"parcelado em 10" e "10 vezes" também valem como parcelas', () => {
    const [p1] = interpretarDitado("comprei tenis de 500 parcelado em 10", ctxBase);
    expect(p1).toMatchObject({ parcelas: 10 });
    const [p2] = interpretarDitado("comprei tenis de 500 em 10 vezes", ctxBase);
    expect(p2).toMatchObject({ parcelas: 10 });
  });

  it("parcelas fora de 2 a 48 valem 1x", () => {
    const [p] = interpretarDitado("comprei tenis de 500 em 1x", ctxBase);
    expect(p).toMatchObject({ parcelas: 1 });
  });

  it("datas: anteontem, semana passada, dd/mm e dia N", () => {
    expect(interpretarDitado("gastei 10 anteontem", ctxBase)[0]).toMatchObject({ data: "2026-09-25" });
    expect(interpretarDitado("gastei 10 semana passada", ctxBase)[0]).toMatchObject({ data: "2026-09-20" });
    expect(interpretarDitado("gastei 10 no dia 15", ctxBase)[0]).toMatchObject({ data: "2026-09-15" });
    expect(interpretarDitado("gastei 10 em 05/09", ctxBase)[0]).toMatchObject({ data: "2026-09-05" });
    expect(interpretarDitado("gastei 10 em 05/09/25", ctxBase)[0]).toMatchObject({ data: "2025-09-05" });
  });

  it('valor "R$ 45,90" e "1,5 mil" e número simples', () => {
    expect(interpretarDitado("gastei R$ 45,90 no mercado", ctxBase)[0]).toMatchObject({ valor: 4590 });
    expect(interpretarDitado("gastei 1,5 mil na reforma", ctxBase)[0]).toMatchObject({ valor: 150000 });
    expect(interpretarDitado("gastei 30 reais no busao", ctxBase)[0]).toMatchObject({ valor: 3000 });
  });

  it("dinheiro/espécie aponta para a conta cujo nome contém dinheiro", () => {
    const [p] = interpretarDitado("paguei 20 em dinheiro no busao", ctxBase);
    expect(p).toMatchObject({ contaId: "dinheiro" });
  });

  it("sem conta nem cartão mencionados, usa a primeira conta", () => {
    const [p] = interpretarDitado("gastei 10 na padaria", ctxBase);
    expect(p).toMatchObject({ contaId: "conta-corrente", cartaoId: null });
  });

  it("categoria padrão quando nada casa: Outros gastos (saída) e Outras entradas (entrada)", () => {
    const [saida] = interpretarDitado("gastei 10 com algo bem incomum", ctxBase);
    expect(saida).toMatchObject({ categoriaId: "outros-gastos" });
    const [entrada] = interpretarDitado("recebi 10 de algo bem incomum", ctxBase);
    expect(entrada).toMatchObject({ categoriaId: "outras-entradas" });
  });
});
