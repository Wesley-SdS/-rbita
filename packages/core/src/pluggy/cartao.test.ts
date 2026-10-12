import { describe, expect, it } from "vitest";
import { faturasDoCartao } from "../finance/cartao";
import type { Lancamento } from "../finance/tipos";
import { acharFaturaDoPagamento, dataNaFaturaDoBanco, fechamentoDaFatura, normalizarCompraDoCartao, pareceDebitoDeFatura, type CompraBruta, type FaturaConhecida } from "./cartao";
import { planejar, type EntradaDoPlano } from "./plano";
import type { TxBanco } from "./normalizar";

// fecha dia 7, vence dia 15: a fatura de outubro fecha em 07/10 e vence em 15/10
const cartao = { id: "cartao-1", limite: 500000, fechamento: 7, vencimento: 15 };

const compra = (p: Partial<CompraBruta> = {}): CompraBruta => ({
  id: "k1", date: "2026-10-03T00:00:00.000Z", amount: 120, type: "DEBIT", status: "POSTED", description: "MERCADO LIVRE", currencyCode: "BRL", ...p,
});

describe("normalizarCompraDoCartao", () => {
  it("compra vira despesa em centavos, no dia da compra", () => {
    expect(normalizarCompraDoCartao(compra(), "c")).toMatchObject({ natureza: "despesa", valor: 12000, data: "2026-10-03", estorno: false, parcelaN: null });
  });

  it("parcela traz o número e o total, e o id da fatura do banco", () => {
    const r = normalizarCompraDoCartao(compra({ creditCardMetadata: { installmentNumber: 3, totalInstallments: 10, billId: "b1" } }), "c");
    expect(r).toMatchObject({ parcelaN: 3, parcelaDe: 10, billId: "b1" });
  });

  it("compra à vista (1 de 1) não é parcela", () => {
    expect(normalizarCompraDoCartao(compra({ creditCardMetadata: { installmentNumber: 1, totalInstallments: 1 } }), "c")?.parcelaN).toBeNull();
  });

  it("crédito é estorno (abate gasto), nunca renda", () => {
    expect(normalizarCompraDoCartao(compra({ type: "CREDIT", description: "ESTORNO COMPRA" }), "c")).toMatchObject({ natureza: "receita", estorno: true });
  });

  it("o pagamento recebido é o outro lado do pagamento da fatura: não vira entrada", () => {
    for (const d of ["Pagamento recebido", "PAGAMENTO EFETUADO", "PGTO FATURA", "Pagamento de fatura"]) {
      expect(normalizarCompraDoCartao(compra({ type: "CREDIT", description: d }), "c"), d).toBeNull();
    }
  });

  it("não entra: pendente, moeda estrangeira, sem tipo (o sinal não é confiável) e valor zero", () => {
    expect(normalizarCompraDoCartao(compra({ status: "PENDING" }), "c")).toBeNull();
    expect(normalizarCompraDoCartao(compra({ currencyCode: "USD" }), "c")).toBeNull();
    expect(normalizarCompraDoCartao(compra({ type: null }), "c")).toBeNull();
    expect(normalizarCompraDoCartao(compra({ amount: 0 }), "c")).toBeNull();
  });
});

describe("fechamentoDaFatura e dataNaFaturaDoBanco", () => {
  it("o vencimento da fatura diz qual é o fechamento da Órbita", () => {
    expect(fechamentoDaFatura(cartao, { dueDate: "2026-10-15" })).toBe("2026-10-07");
    expect(fechamentoDaFatura(cartao, { dueDate: "2026-11-15" })).toBe("2026-11-07");
  });

  it("vencimento deslocado (caiu no domingo): vale o mês do fechamento que o banco informou", () => {
    expect(fechamentoDaFatura(cartao, { dueDate: "2026-10-16", billClosingDate: "2026-10-08" })).toBe("2026-10-07");
  });

  it("sem vencimento e sem fechamento legíveis: nulo, e a compra fica com a data que veio", () => {
    expect(fechamentoDaFatura(cartao, { dueDate: "?" })).toBeNull();
    expect(dataNaFaturaDoBanco(cartao, "2026-10-03", null)).toBe("2026-10-03");
  });

  it("compra que a Órbita poria noutra fatura vai para a fatura do banco; a que já cai na certa não muda", () => {
    // o banco fechou em 08/10 e esta compra de 08/10 é da fatura de outubro; pela regra do dia 7 iria para novembro
    expect(dataNaFaturaDoBanco(cartao, "2026-10-08", "2026-10-07")).toBe("2026-10-07");
    expect(dataNaFaturaDoBanco(cartao, "2026-10-03", "2026-10-07")).toBe("2026-10-03");
  });

  it("a compra movida de fato cai na fatura do banco quando o motor agrupa", () => {
    const l = (id: string, data: string, valor: number): Lancamento => ({ id, tipo: "despesa", data, valor, cartaoId: cartao.id });
    const movida = dataNaFaturaDoBanco(cartao, "2026-10-08", "2026-10-07");
    const faturas = faturasDoCartao(cartao, [l("a", "2026-10-03", 1000), l("b", movida, 2000)], []);
    expect(faturas).toHaveLength(1);
    expect(faturas[0]).toMatchObject({ fechamento: "2026-10-07", total: 3000 });
  });
});

describe("pagamento de fatura na conta corrente", () => {
  const fatura = (p: Partial<FaturaConhecida> = {}): FaturaConhecida => ({ cartaoId: "cartao-1", fechamento: "2026-10-07", vencimento: "2026-10-15", total: 123456, billId: "b1", ...p });

  it("reconhece a descrição de fatura e ignora o resto", () => {
    for (const d of ["PAGAMENTO FATURA ITAU", "PGTO CARTAO CREDITO", "Pagamento de cartão", "FATURA NUBANK"]) expect(pareceDebitoDeFatura(d), d).toBe(true);
    for (const d of ["PIX MARIA", "MERCADO", "ACADEMIA"]) expect(pareceDebitoDeFatura(d), d).toBe(false);
  });

  it("valor igual ao total, perto do vencimento: acha a fatura", () => {
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-10-14", valor: 123456 }, [fatura()])?.billId).toBe("b1");
  });

  it("pagamento parcial que só cabe numa fatura também acha", () => {
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-10-15", valor: 50000 }, [fatura()])?.billId).toBe("b1");
  });

  it("sem descrição de fatura, longe do vencimento, valor maior que o total ou duas candidatas: nenhuma (fica saída comum)", () => {
    expect(acharFaturaDoPagamento({ descricao: "PIX JOAO", data: "2026-10-14", valor: 123456 }, [fatura()])).toBeNull();
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-09-01", valor: 123456 }, [fatura()])).toBeNull();
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-10-14", valor: 200000 }, [fatura()])).toBeNull();
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-10-14", valor: 50000 }, [fatura(), fatura({ cartaoId: "cartao-2", billId: "b2" })])).toBeNull();
  });

  it("duas faturas de mesmo total: o valor exato não escolhe sozinho", () => {
    expect(acharFaturaDoPagamento({ descricao: "PAGAMENTO FATURA", data: "2026-10-14", valor: 123456 }, [fatura(), fatura({ cartaoId: "cartao-2", billId: "b2" })])).toBeNull();
  });
});

describe("planejar · pagamento de fatura é separado antes do pareamento", () => {
  const entrada = (p: Partial<EntradaDoPlano> & Pick<EntradaDoPlano, "novas">): EntradaDoPlano => ({
    soltas: [], manuais: [], contaDe: new Map([["A", "conta-a"], ["B", "conta-b"]]), janelaDias: 2, diasRepetido: 2,
    reconhecerTransferencias: true, compararComManuais: new Set(), novoGrupo: () => "g", ...p,
  });
  const tx = (p: Partial<TxBanco> & Pick<TxBanco, "pluggyId" | "contaRef" | "natureza" | "valor" | "data" | "descricao">): TxBanco => ({ propria: false, terceiro: false, ...p });
  const fatura: FaturaConhecida = { cartaoId: "cartao-1", fechamento: "2026-10-07", vencimento: "2026-10-15", total: 123456, billId: "b1" };

  it("o débito da fatura vira pagamento_fatura, e NÃO pareia com uma entrada de mesmo valor em outra conta", () => {
    const debito = tx({ pluggyId: "d", contaRef: "A", natureza: "despesa", valor: 123456, data: "2026-10-14", descricao: "PAGAMENTO FATURA" });
    const entradaIgual = tx({ pluggyId: "e", contaRef: "B", natureza: "receita", valor: 123456, data: "2026-10-14", descricao: "Pix recebido" });
    const r = planejar(entrada({ novas: [debito, entradaIgual], faturas: [fatura] }));
    expect(r.find((d) => d.tx.pluggyId === "d")).toMatchObject({ acao: "pagamento_fatura", fatura: { billId: "b1" } });
    expect(r.find((d) => d.tx.pluggyId === "e")?.acao).toBe("lancar");
  });

  it("CONTROLE: sem fatura conhecida, o mesmo débito segue o caminho normal (e pareia se houver entrada)", () => {
    const debito = tx({ pluggyId: "d", contaRef: "A", natureza: "despesa", valor: 123456, data: "2026-10-14", descricao: "PAGAMENTO FATURA" });
    const entradaIgual = tx({ pluggyId: "e", contaRef: "B", natureza: "receita", valor: 123456, data: "2026-10-14", descricao: "Pix recebido" });
    expect(planejar(entrada({ novas: [debito, entradaIgual] })).every((d) => d.acao === "transferencia")).toBe(true);
  });

  it("cada fatura é paga uma vez por volta: o segundo débito igual segue como saída comum", () => {
    const d1 = tx({ pluggyId: "d1", contaRef: "A", natureza: "despesa", valor: 123456, data: "2026-10-14", descricao: "PAGAMENTO FATURA" });
    const d2 = { ...d1, pluggyId: "d2" };
    const r = planejar(entrada({ novas: [d1, d2], faturas: [fatura] }));
    expect(r.map((d) => d.acao).sort()).toEqual(["lancar", "pagamento_fatura"]);
  });
});
