import { describe, it, expect } from "vitest";
import { diaNoMes, diasNoMes, somarMeses, somarDias, diasEntre } from "./calendario";
import { dividirEmParcelas } from "./parcelas";
import { fechamentoDaCompra, vencimentoDaFatura, faturaAberta, faturasDoCartao, limiteDoCartao } from "./cartao";
import { projetarQuitacao, saldoDevedor, dividirPagamento } from "./divida";
import {
  classificarGasto, farol, gastoDoMes, gastoPorCategoria, gastoDiario, janela, mediaGastoLivre,
  possoGastar, previstoDoMes, saldoTotal, situacaoDaConta, baseDoMes, entradaDoMes,
} from "./mes";
import { contaProjetada, preverMeses } from "./previsao";
import { semearRecorrentes, propagarEdicao } from "./recorrentes";
import { sugerirAtalhos } from "./sugestoes";
import { resumirMeta } from "./metas";
import { LIMIARES_PADRAO, type Cartao, type Compromisso, type EstadoFinanceiro, type Lancamento } from "./tipos";

let seq = 0;
const L = (over: Partial<Lancamento>): Lancamento => ({ id: `l${++seq}`, tipo: "despesa", data: "2026-09-10", valor: 1000, contaId: "c1", ...over });
const C = (over: Partial<Compromisso>): Compromisso => ({
  id: `k${++seq}`, direcao: "pagar", descricao: "Aluguel", valor: 100000, vencimento: "2026-09-08", recorrencia: "nenhuma", status: "aberto", ...over,
});
const estado = (over: Partial<EstadoFinanceiro> = {}): EstadoFinanceiro => ({
  renda: 0, teto: 0, contas: [{ id: "c1", saldoInicial: 0 }], cartoes: [], lancamentos: [], compromissos: [], dividas: [], pagamentosFatura: [], categorias: [], ...over,
});

describe("calendário", () => {
  it("limita o dia ao fim do mês e soma meses atravessando o ano", () => {
    expect(diaNoMes("2026-02", 31)).toBe("2026-02-28");
    expect(diaNoMes("2028-02", 31)).toBe("2028-02-29");
    expect(somarMeses("2026-11", 3)).toBe("2027-02");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(diasNoMes("2026-09")).toBe(30);
    expect(somarDias("2026-09-28", 5)).toBe("2026-10-03");
    expect(diasEntre("2026-09-26", "2026-09-20")).toBe(-6);
  });
});

describe("parcelas (§5.18)", () => {
  it("100,00 em 3x: o resto do centavo vai para a primeira", () => {
    const p = dividirEmParcelas(10000, 3, "2026-01-31", "Geladeira");
    expect(p.map((x) => x.valor)).toEqual([3334, 3333, 3333]);
    expect(p.map((x) => x.data)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(p[1]!.descricao).toBe("Geladeira (2/3)");
  });

  it("uma parcela só não ganha sufixo e número inválido vira 1", () => {
    expect(dividirEmParcelas(500, 0, "2026-09-01", "Pão")).toEqual([{ n: 1, de: 1, valor: 500, data: "2026-09-01", descricao: "Pão" }]);
  });
});

describe("cartão (§5.12 a §5.14)", () => {
  const fecha5: Cartao = { id: "nu", limite: 500000, fechamento: 5, vencimento: 12 };

  it("compra até o fechamento cai na fatura do mês; depois, na do mês seguinte", () => {
    expect(fechamentoDaCompra(fecha5, "2026-09-03")).toBe("2026-09-05");
    expect(fechamentoDaCompra(fecha5, "2026-09-05")).toBe("2026-09-05");
    expect(fechamentoDaCompra(fecha5, "2026-09-06")).toBe("2026-10-05");
  });

  it("vencimento menor ou igual ao fechamento vence no mês seguinte", () => {
    expect(vencimentoDaFatura({ ...fecha5, fechamento: 25, vencimento: 5 }, "2026-09-25")).toBe("2026-10-05");
    expect(vencimentoDaFatura({ ...fecha5, fechamento: 1, vencimento: 10 }, "2026-09-01")).toBe("2026-09-10");
  });

  it("fatura aberta é a primeira não paga; pagamento parcial deixa restante", () => {
    const ls = [L({ cartaoId: "nu", contaId: null, data: "2026-08-20", valor: 30000 }), L({ cartaoId: "nu", contaId: null, data: "2026-09-10", valor: 5000 })];
    const pag = [{ cartaoId: "nu", fechamento: "2026-09-05", valor: 10000 }];
    const f = faturaAberta(fecha5, ls, pag, "2026-09-26");
    expect(f.fechamento).toBe("2026-09-05");
    expect(f.restante).toBe(20000);
    expect(f.paga).toBe(false);
    expect(faturasDoCartao(fecha5, ls, pag)).toHaveLength(2);
  });

  it("tudo pago: mostra o ciclo atual, mesmo vazio", () => {
    const ls = [L({ cartaoId: "nu", contaId: null, data: "2026-08-20", valor: 30000 })];
    const f = faturaAberta(fecha5, ls, [{ cartaoId: "nu", fechamento: "2026-09-05", valor: 30000 }], "2026-09-26");
    expect(f.fechamento).toBe("2026-10-05");
    expect(f.total).toBe(0);
  });

  it("limite usado soma o rotativo das dívidas do cartão", () => {
    const ls = [L({ cartaoId: "nu", contaId: null, valor: 100000 })];
    const divida = { id: "d", saldoInicial: 50000, jurosMes: 10, parcelaMensal: 0, cartaoId: "nu", pagamentos: [{ abatimento: 20000 }] };
    expect(limiteDoCartao(fecha5, ls, [{ cartaoId: "nu", fechamento: "x", valor: 40000 }], [divida])).toEqual({ usado: 90000, livre: 410000 });
  });
});

describe("dívida (§5.15)", () => {
  it("quitada, sem parcela e parcela que não cobre os juros", () => {
    expect(projetarQuitacao(0, 5, 100)).toEqual({ tipo: "quitada" });
    expect(projetarQuitacao(100000, 5, 0)).toEqual({ tipo: "impossivel", motivo: "sem_parcela" });
    expect(projetarQuitacao(100000, 10, 10000)).toEqual({ tipo: "impossivel", motivo: "parcela_nao_cobre_juros" });
  });

  it("sem juros, 1.000 pagando 300 acaba em 4 meses sem juros", () => {
    expect(projetarQuitacao(100000, 0, 30000)).toEqual({ tipo: "previsao", meses: 4, totalPago: 100000, juros: 0 });
  });

  it("com juros, paga mais que o saldo", () => {
    const q = projetarQuitacao(100000, 2, 30000);
    expect(q.tipo).toBe("previsao");
    if (q.tipo === "previsao") {
      expect(q.meses).toBe(4);
      expect(q.juros).toBeGreaterThan(0);
    }
  });

  it("saldo devedor nunca é negativo e o pagamento separa juros de abatimento", () => {
    expect(saldoDevedor({ id: "d", saldoInicial: 100, jurosMes: 0, parcelaMensal: 0, pagamentos: [{ abatimento: 500 }] })).toBe(0);
    expect(dividirPagamento(100000, 2, 30000)).toEqual({ juros: 2000, abatimento: 28000 });
  });
});

describe("mês (§5.1 a §5.11)", () => {
  it("transferência não é gasto nem entrada; estorno abate", () => {
    const ls = [
      L({ valor: 5000, categoriaId: "mercado" }),
      L({ valor: 99999, transferencia: true }),
      L({ tipo: "receita", valor: 1000, estorno: true, categoriaId: "mercado" }),
      L({ tipo: "receita", valor: 300000 }),
      L({ tipo: "receita", valor: 99999, transferencia: true }),
    ];
    expect(gastoDoMes(ls, "2026-09")).toBe(4000);
    expect(entradaDoMes(ls, "2026-09")).toBe(300000);
    expect(gastoPorCategoria(ls, "2026-09")).toEqual([{ categoriaId: "mercado", total: 4000 }]);
    expect(saldoTotal([{ id: "c1", saldoInicial: 10000 }], ls)).toBe(10000 - 5000 - 99999 + 1000 + 300000 + 99999);
  });

  it("saldo até hoje ignora parcela futura na conta", () => {
    expect(saldoTotal([{ id: "c1", saldoInicial: 100 }], [L({ data: "2026-12-01", valor: 40 })], "2026-09-26")).toBe(100);
  });

  it("cartão não mexe no saldo da conta", () => {
    expect(saldoTotal([{ id: "c1", saldoInicial: 100 }], [L({ cartaoId: "nu", valor: 50 })])).toBe(100);
  });

  it("gasto diário acumula", () => {
    const g = gastoDiario([L({ data: "2026-09-01", valor: 100 }), L({ data: "2026-09-03", valor: 50 })], "2026-09");
    expect(g.acumulado.slice(0, 4)).toEqual([100, 100, 150, 150]);
  });

  it("classifica fixo, parcela, projeto e livre", () => {
    const ls = [
      L({ valor: 100000, fixo: true }),
      L({ valor: 20000, parcelaN: 1, parcelaDe: 10 }),
      L({ valor: 30000, metaId: "ap", parcelaDe: 5 }),
      L({ valor: 7000 }),
    ];
    expect(classificarGasto(ls, "2026-09")).toEqual({ gasto: 157000, fixos: 100000, parcelas: 20000, projetos: 30000, livre: 7000 });
  });

  it("exemplo do PRD: renda 10.000, fixos 4.000, parcelas 1.000, livre 3.000 no dia 20 de 30", () => {
    const p = possoGastar(1_000_000, 500_000, 300_000, "2026-09", "2026-09-20");
    expect(p).toEqual({ disponivel: 500_000, sobra: 200_000, diasRestantes: 11, porDia: 18181 });
  });

  it("outro mês que não o atual divide por 1", () => {
    expect(possoGastar(1000, 0, 0, "2026-08", "2026-09-20").diasRestantes).toBe(1);
  });

  it("previsto conta todas as contas a pagar do mês, quitadas ou não; metas fora do comprometido", () => {
    const cs = [C({ valor: 300000 }), C({ valor: 100000, status: "quitado" }), C({ direcao: "receber", valor: 5 }), C({ vencimento: "2026-10-08" })];
    const ls = [L({ valor: 100000, parcelaDe: 3 }), L({ valor: 50000, metaId: "m" })];
    expect(previstoDoMes(ls, cs, "2026-09")).toEqual({ contasFixas: 400000, parcelas: 100000, metas: 50000, comprometido: 500000 });
  });

  it("base: renda, senão teto, senão nada", () => {
    expect(baseDoMes(5, 9)).toBe(5);
    expect(baseDoMes(0, 9)).toBe(9);
    expect(baseDoMes(0, 0)).toBeNull();
  });

  it("situação e janela contam o vencido", () => {
    const hoje = "2026-09-26";
    expect(situacaoDaConta(C({ vencimento: "2026-09-25" }), hoje, 7)).toBe("vencido");
    expect(situacaoDaConta(C({ vencimento: "2026-10-03" }), hoje, 7)).toBe("perto");
    expect(situacaoDaConta(C({ vencimento: "2026-10-04" }), hoje, 7)).toBe("aberto");
    expect(situacaoDaConta(C({ status: "quitado" }), hoje, 7)).toBe("quitado");
    const cs = [C({ vencimento: "2026-09-01", valor: 100 }), C({ vencimento: "2026-10-20", valor: 10 }), C({ vencimento: "2026-11-30", valor: 1 }), C({ direcao: "receber", vencimento: "2026-10-01", valor: 7 })];
    expect(janela(cs, hoje, 30)).toEqual({ aPagar: 110, aReceber: 7, emAtraso: 100 });
  });

  it("média de gasto livre ignora mês sem lançamento e o mês atual", () => {
    const ls = [L({ data: "2026-08-10", valor: 3000 }), L({ data: "2026-06-10", valor: 1000 }), L({ data: "2026-09-10", valor: 99999 })];
    expect(mediaGastoLivre(ls, "2026-09-26", 3)).toBe(2000);
    expect(mediaGastoLivre([], "2026-09-26", 3)).toBe(0);
  });
});

describe("farol (§6.1.2)", () => {
  it("modo A: com renda mas sem saber o que sai, não inventa número", () => {
    expect(farol(estado({ renda: 1_000_000 }), "2026-09", "2026-09-10", LIMIARES_PADRAO)).toEqual({ modo: "sem_saidas", base: 1_000_000 });
  });

  it("modo B vira 'até o fim do mês' faltando 5 dias ou menos, e nunca é negativo", () => {
    const e = estado({ renda: 100_000, lancamentos: [L({ valor: 150_000 })] });
    const f = farol(e, "2026-09", "2026-09-26", LIMIARES_PADRAO);
    expect(f.modo).toBe("posso_gastar");
    if (f.modo === "posso_gastar") {
      expect(f.fimDoMes).toBe(true);
      expect(f.valor).toBe(0);
      expect(f.sobra).toBe(-50_000);
      expect(f.usoPct).toBe(100);
    }
  });

  it("modo C sem base mas com contas; modo D sem nada", () => {
    const c = farol(estado({ compromissos: [C({ vencimento: "2026-09-30", valor: 500 })] }), "2026-09", "2026-09-26", LIMIARES_PADRAO);
    expect(c).toEqual({ modo: "previsao_30", sobra: -500, saldo: 0, aReceber: 0, aPagar: 500 });
    const d = farol(estado({ lancamentos: [L({ valor: 2600 })] }), "2026-09", "2026-09-26", LIMIARES_PADRAO);
    expect(d).toEqual({ modo: "gasto_do_mes", gasto: 2600, teto: null, ritmoDia: 100, projecao: 3000 });
  });
});

describe("previsão (§6.6)", () => {
  it("série mensal continua além do que foi semeado", () => {
    const cs = [C({ recorrencia: "mensal", serieId: "s", vencimento: "2026-09-08", valor: 100 }), C({ recorrencia: "mensal", serieId: "s", vencimento: "2026-10-08", valor: 120 })];
    expect(contaProjetada(cs, "2026-10", "pagar")).toBe(120);
    expect(contaProjetada(cs, "2027-01", "pagar")).toBe(120);
    expect(contaProjetada(cs, "2026-08", "pagar")).toBe(0);
  });

  it("projeta 12 meses, saldo corre só nos futuros e acha o mês mais apertado", () => {
    const e = estado({
      renda: 500_000,
      contas: [{ id: "c1", saldoInicial: 100_000 }],
      compromissos: [C({ recorrencia: "mensal", serieId: "s", vencimento: "2026-09-08", valor: 200_000 })],
      lancamentos: [L({ data: "2026-08-05", valor: 100_000 }), L({ data: "2026-12-05", valor: 400_000, metaId: "ap" })],
    });
    const p = preverMeses(e, "2026-09-26", LIMIARES_PADRAO);
    expect(p.meses).toHaveLength(12);
    expect(p.meses[0]!.saldoProjetado).toBeNull();
    expect(p.mediaLivre).toBe(100_000);
    // outubro: 0 (saldo 100.000 - 100.000 do gasto de agosto) + 500.000 - 200.000 - 100.000
    expect(p.meses[1]!.saldoProjetado).toBe(0 + 500_000 - 200_000 - 100_000);
    expect(p.maisApertado!.mes).toBe("2026-12");
    expect(p.maisApertado!.livre).toBe(500_000 - 600_000);
  });
});

describe("contas fixas (§4.4 e §4.5)", () => {
  it("semeia até dois meses à frente, no dia da série, sem duplicar", () => {
    let n = 0;
    const cs = [C({ id: "a", recorrencia: "mensal", serieId: "a", diaMes: 31, vencimento: "2026-08-31" })];
    const novos = semearRecorrentes(cs, "2026-09-26", 2, () => `n${++n}`);
    expect(novos.map((c) => c.vencimento)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
    expect(semearRecorrentes([...cs, ...novos], "2026-09-26", 2, () => "x")).toEqual([]);
  });

  it("não cria no mês em que já há conta de mesma direção e descrição", () => {
    const cs = [C({ id: "a", recorrencia: "mensal", serieId: "a", vencimento: "2026-09-08" }), C({ descricao: "ALUGUEL ", vencimento: "2026-10-02" })];
    expect(semearRecorrentes(cs, "2026-09-26", 2, () => "n").map((c) => c.vencimento)).toEqual(["2026-11-08"]);
  });

  it("edição propaga só para posteriores em aberto", () => {
    const a = C({ id: "a", serieId: "s", vencimento: "2026-09-08" });
    const cs = [a, C({ id: "b", serieId: "s", vencimento: "2026-10-08" }), C({ id: "c", serieId: "s", vencimento: "2026-11-08", status: "quitado" }), C({ id: "z", serieId: "s", vencimento: "2026-08-08" })];
    const mud = propagarEdicao(cs, a, { descricao: "Aluguel novo", valor: 1, diaMes: 31 });
    expect(mud.map((c) => [c.id, c.vencimento, c.valor])).toEqual([["b", "2026-10-31", 1]]);
  });
});

describe("atalhos e metas", () => {
  it("sugere pela mediana o que se repete 3 vezes, ignorando parcela e transferência", () => {
    const ls = [
      L({ descricao: "Café", valor: 800, data: "2026-09-01" }), L({ descricao: "café", valor: 900 }), L({ descricao: "Café", valor: 4000 }),
      L({ descricao: "Uber", valor: 2000 }), L({ descricao: "Uber", valor: 2000 }),
      L({ descricao: "TV", valor: 1, parcelaDe: 10 }), L({ descricao: "TV", valor: 1, parcelaDe: 10 }), L({ descricao: "TV", valor: 1, parcelaDe: 10 }),
    ];
    expect(sugerirAtalhos(ls, [], 3)).toEqual([{ rotulo: "Café", valor: 900, categoriaId: null, contaId: "c1", cartaoId: null, vezes: 3 }]);
  });

  it("resumo da meta separa pago, a vencer e sem contratar", () => {
    const r = resumirMeta([{ valor: 1000 }, { valor: 500 }], [L({ data: "2026-09-01", valor: 300 }), L({ data: "2026-10-01", valor: 300 })], "2026-09-26");
    expect(r).toEqual({ total: 1500, jaPago: 300, aVencer: 300, semContratar: 900 });
  });
});
