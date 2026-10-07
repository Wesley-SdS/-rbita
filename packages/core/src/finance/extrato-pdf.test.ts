import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { gerarExtratoPdf, seguro, type ExtratoParaPdf } from "./extrato-pdf";
import type { LinhaDeLancamento } from "./visoes";

const lanc = (over: Partial<LinhaDeLancamento>): LinhaDeLancamento => ({
  id: "l", natureza: "despesa", data: "2026-10-05", valor: 4590, descricao: "Mercado", titulo: "Mercado", categoriaId: "c",
  categoria: { nome: "Mercado", cor: "#000000", iniciais: "M" }, contaId: "c1", cartaoId: null, onde: "Conta corrente",
  transferencia: false, grupoTransferencia: null, estorno: false, fixo: false, grupoParcela: null, parcelaN: null, parcelaDe: null,
  metaId: null, compromissoId: null, ...over,
});

const base = (over: Partial<ExtratoParaPdf> = {}): ExtratoParaPdf => ({
  mes: "2026-10",
  hoje: "2026-10-06",
  resumo: { n: 2, saidas: 4590, entradas: 1900000, previstos: 1, aPagar: 39190, aReceber: 0 },
  previstos: [{ id: "k", direcao: "pagar", descricao: "Fatura Itaú", valor: 39190, vencimento: "2026-10-13", situacao: "perto", fixa: false, quitadoEm: null, categoriaId: null, categoria: null, contaId: null }],
  dias: [{ data: "2026-10-05", totalSaidas: 4590, itens: [lanc({ id: "a", natureza: "receita", valor: 1900000, titulo: "Adalink", categoria: { nome: "Salário", cor: "#000000", iniciais: "S" } }), lanc({ id: "b" })] }],
  saldoContas: 1895410,
  ...over,
});

async function textoDo(pdf: Uint8Array): Promise<{ texto: string; paginas: number }> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { texto: text, paginas: totalPages };
}

describe("extrato em PDF", () => {
  it("leva o resumo, o previsto e cada lançamento com sinal, categoria e conta", async () => {
    const { texto, paginas } = await textoDo(await gerarExtratoPdf(base({ filtros: "Só saídas", titular: "Wesley" })));
    expect(paginas).toBe(1);
    for (const esperado of ["Extrato", "Outubro de 2026", "Filtros: Só saídas", "R$ 19.000,00", "Fatura Itaú", "Adalink", "Salário", "- R$ 45,90", "Conta corrente", "página 1 de 1"]) {
      expect(texto, esperado).toContain(esperado);
    }
  });

  it("muitos lançamentos viram várias páginas, com a paginação certa", async () => {
    const itens = Array.from({ length: 80 }, (_, i) => lanc({ id: `x${i}`, titulo: `Gasto ${i}` }));
    const { texto, paginas } = await textoDo(await gerarExtratoPdf(base({ dias: [{ data: "2026-10-05", totalSaidas: 0, itens }] })));
    expect(paginas).toBeGreaterThan(1);
    expect(texto).toContain(`página ${paginas} de ${paginas}`);
    expect(texto).toContain("Gasto 79");
  });

  it("mês vazio diz que não há lançamento, e não quebra", async () => {
    const { texto } = await textoDo(await gerarExtratoPdf(base({ dias: [], previstos: [], resumo: { n: 0, saidas: 0, entradas: 0, previstos: 0, aPagar: 0, aReceber: 0 } })));
    expect(texto).toContain("Nenhum lançamento neste mês");
  });

  it("emoji e sinal tipográfico não derrubam o documento", async () => {
    expect(seguro("Café ☕ − 10")).toBe("Café - 10");
    const pdf = await gerarExtratoPdf(base({ dias: [{ data: "2026-10-05", totalSaidas: 0, itens: [lanc({ titulo: "💧 Água — ok" })] }] }));
    expect((await textoDo(pdf)).texto).toContain("Água — ok");
  });
});
