import { describe, it, expect } from "vitest";
import { summarizeBills, type BillDueItem } from "./bill-due";

/** Atalho para montar um item sem repetir os campos que não importam ao teste. */
function item(over: Partial<BillDueItem>): BillDueItem {
  return { descricao: "Conta", valor: 100, tipo: "a_pagar", vencimento: "2026-09-20", vencida: false, ...over };
}

// `toLocaleString` do Node usa espaço fino inseparável (U+00A0, char code 160)
// entre "R$" e o valor, não o espaço comum; visualmente idêntico no editor e
// no terminal, mas quebraria um `toBe` escrito com espaço normal. Monta a
// string com `String.fromCharCode` para o caractere ficar explícito na fonte.
const NBSP = String.fromCharCode(160);
const brl = (v: string) => `R$${NBSP}${v}`;

describe("summarizeBills", () => {
  it("lista vazia gera texto vazio", () => {
    expect(summarizeBills([])).toBe("");
  });

  it("conta a pagar, não vencida, formata valor em BRL e data em dd/mm/aaaa", () => {
    const texto = summarizeBills([item({ descricao: "Internet", valor: 129.9, tipo: "a_pagar", vencimento: "2026-09-20", vencida: false })]);
    expect(texto).toBe(`Pagar: Internet ${brl("129,90")} em 20/09/2026`);
  });

  it("conta a receber usa o rótulo Receber", () => {
    const texto = summarizeBills([item({ descricao: "Cliente X", valor: 500, tipo: "a_receber", vencimento: "2026-10-01", vencida: false })]);
    expect(texto).toBe(`Receber: Cliente X ${brl("500,00")} em 01/10/2026`);
  });

  it("conta vencida ganha o prefixo VENCIDA", () => {
    const texto = summarizeBills([item({ descricao: "Água", valor: 80, tipo: "a_pagar", vencimento: "2026-09-01", vencida: true })]);
    expect(texto).toBe(`VENCIDA Pagar: Água ${brl("80,00")} em 01/09/2026`);
  });

  it("sem data de vencimento, omite o trecho 'em dd/mm/aaaa'", () => {
    const texto = summarizeBills([item({ descricao: "Assinatura", valor: 30, tipo: "a_pagar", vencimento: null, vencida: false })]);
    expect(texto).toBe(`Pagar: Assinatura ${brl("30,00")}`);
  });

  it("várias contas viram uma linha cada, na ordem recebida", () => {
    const texto = summarizeBills([
      item({ descricao: "Luz", valor: 200, tipo: "a_pagar", vencimento: "2026-09-05", vencida: true }),
      item({ descricao: "Salário", valor: 3000, tipo: "a_receber", vencimento: "2026-09-30", vencida: false }),
    ]);
    expect(texto.split("\n")).toEqual([`VENCIDA Pagar: Luz ${brl("200,00")} em 05/09/2026`, `Receber: Salário ${brl("3.000,00")} em 30/09/2026`]);
  });
});
