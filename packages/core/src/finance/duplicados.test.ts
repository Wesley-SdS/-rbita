import { describe, expect, it } from "vitest";
import { acharRepetidos, descricoesParecidas, ehRepetido, type LancamentoComparavel } from "./duplicados";

const L = (over: Partial<LancamentoComparavel>): LancamentoComparavel => ({ tipo: "despesa", data: "2026-10-05", valor: 10000, descricao: "Abastecimento", contaId: "c1", ...over });

describe("lançamento repetido (como Pix repetido no banco)", () => {
  it("o caso real: o mesmo abastecimento e o mesmo boleto lançados duas vezes", () => {
    expect(ehRepetido(L({}), L({}), 2)).toBe(true);
    expect(ehRepetido(L({ valor: 260193, descricao: "Boleto Grpqa" }), L({ valor: 260193, descricao: "Boleto Grpqa , boleto Casas Bahia $ 50,43," }), 2)).toBe(true);
  });

  it("valor, natureza, data longe ou conta diferente: não é repetido", () => {
    expect(ehRepetido(L({ valor: 10001 }), L({}), 2)).toBe(false);
    expect(ehRepetido(L({ tipo: "receita" }), L({}), 2)).toBe(false);
    expect(ehRepetido(L({ data: "2026-10-09" }), L({}), 2)).toBe(false);
    expect(ehRepetido(L({ data: "2026-10-07" }), L({}), 2)).toBe(true);
    expect(ehRepetido(L({ contaId: "din" }), L({}), 2)).toBe(false);
    expect(ehRepetido(L({ contaId: null, cartaoId: "nu" }), L({ contaId: null, cartaoId: "itau" }), 2)).toBe(false);
  });

  it("descrição: palavra própria em comum identifica; genérica não; vazia não atrapalha", () => {
    expect(descricoesParecidas("Pix Villa dos Bichos", "Villa dos Bichos")).toBe(true);
    expect(descricoesParecidas("Boleto Comgas", "Boleto Santander")).toBe(false);
    expect(descricoesParecidas("Café da padaria", "Almoço")).toBe(false);
    expect(descricoesParecidas(null, "Almoço")).toBe(true);
  });

  it("acha repetido contra o que existe E dentro do próprio lote", () => {
    const existentes = [L({ descricao: "Abastecimento" })];
    const lote = [L({ valor: 5043, descricao: "Boleto Casas Bahia" }), L({ descricao: "Abastecimento" }), L({ valor: 5043, descricao: "Casas Bahia" })];
    const r = acharRepetidos(lote, existentes, 2);
    expect(r.map((x) => x.indice)).toEqual([1, 2]);
    expect(r[1]!.igual).toBe(lote[0]);
    expect(acharRepetidos([L({ valor: 1 })], existentes, 2)).toEqual([]);
  });
});
