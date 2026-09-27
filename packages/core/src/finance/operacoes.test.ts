import { describe, it, expect } from "vitest";
import {
  lancamentosDoPedido, pernasDaTransferencia, lancamentoDaQuitacao, planoDePagarFatura, planoDePagarDivida,
  lancamentosDoItem, RegraFinanceiraError, type ItemDeMetaParaLancar,
} from "./operacoes";
import { itensDoModelo, corDaVez, PALETA } from "./padroes";

const grupo = () => "g1";

describe("lançamento novo (§7.1)", () => {
  it("parcela só no cartão: 10x cria dez com grupo e sufixo", () => {
    const ls = lancamentosDoPedido({ tipo: "despesa", valor: 300000, data: "2026-09-10", descricao: "Geladeira", categoriaId: "cmp", cartaoId: "nu", parcelas: 10 }, grupo);
    expect(ls).toHaveLength(10);
    expect(ls[0]).toMatchObject({ cartaoId: "nu", contaId: null, grupoParcela: "g1", parcelaN: 1, parcelaDe: 10, descricao: "Geladeira (1/10)" });
    expect(ls[9]!.data).toBe("2027-06-10");
  });

  it("parcelas numa conta viram lançamento único; sem descrição usa null", () => {
    const ls = lancamentosDoPedido({ tipo: "despesa", valor: 1000, data: "2026-09-10", categoriaId: null, contaId: "c1", parcelas: 5 }, grupo);
    expect(ls).toEqual([{ tipo: "despesa", data: "2026-09-10", valor: 1000, descricao: null, categoriaId: null, contaId: "c1", cartaoId: null, estorno: false, importado: false }]);
  });

  it("estorno só vale em entrada", () => {
    expect(lancamentosDoPedido({ tipo: "despesa", valor: 1, data: "2026-09-10", categoriaId: null, contaId: "c1", estorno: true }, grupo)[0]!.estorno).toBe(false);
    expect(lancamentosDoPedido({ tipo: "receita", valor: 1, data: "2026-09-10", categoriaId: null, contaId: "c1", estorno: true }, grupo)[0]!.estorno).toBe(true);
  });

  it("parcelada sem descrição usa o nome da categoria", () => {
    const ls = lancamentosDoPedido({ tipo: "despesa", valor: 100, data: "2026-09-10", categoriaId: "x", categoriaNome: "Compras", cartaoId: "nu", parcelas: 2 }, grupo);
    expect(ls[1]!.descricao).toBe("Compras (2/2)");
  });
});

describe("transferência (§7.3)", () => {
  const base = { valor: 20000, data: "2026-09-10", origemId: "c1", destinoId: "din", categoriaSaidaId: "ts", categoriaEntradaId: "te", grupo: "t1" };
  it("duas pernas marcadas como transferência", () => {
    const [saida, entrada] = pernasDaTransferencia(base);
    expect(saida).toMatchObject({ tipo: "despesa", contaId: "c1", transferencia: true, grupoTransferencia: "t1", descricao: "Transferência" });
    expect(entrada).toMatchObject({ tipo: "receita", contaId: "din", transferencia: true });
  });
  it("mesma conta ou sem valor é recusado com a mensagem do PRD", () => {
    expect(() => pernasDaTransferencia({ ...base, destinoId: "c1" })).toThrow("Escolha duas contas diferentes.");
    expect(() => pernasDaTransferencia({ ...base, valor: 0 })).toThrow(RegraFinanceiraError);
  });
});

describe("quitar (§7.7)", () => {
  it("sempre marca fixo e liga ao compromisso, mesmo avulsa", () => {
    const l = lancamentoDaQuitacao({ id: "k1", direcao: "pagar", descricao: "IPVA", categoriaId: "mor" }, { valor: 5000, data: "2026-09-10", contaId: "c1", cartaoId: null });
    expect(l).toMatchObject({ tipo: "despesa", fixo: true, compromissoId: "k1", contaId: "c1" });
  });
  it("receber nunca vai para cartão", () => {
    const l = lancamentoDaQuitacao({ id: "k1", direcao: "receber", descricao: "Salário", categoriaId: null }, { valor: 1, data: "2026-09-10", contaId: "c1", cartaoId: "nu" });
    expect(l).toMatchObject({ tipo: "receita", contaId: "c1", cartaoId: null });
  });
});

describe("pagar fatura (§7.8)", () => {
  const base = { cartaoNome: "Nubank", fechamento: "2026-09-05", restante: 100000, data: "2026-09-12", contaId: "c1", categoriaFaturaId: "pf" };
  it("pagamento total: transferência, nada rola", () => {
    const p = planoDePagarFatura({ ...base, valor: 100000, resto: "rotativo" });
    expect(p.lancamento).toMatchObject({ transferencia: true, descricao: "Fatura Nubank (05/09)" });
    expect([p.pagamento, p.rolado, p.emAberto]).toEqual([100000, 0, 0]);
  });
  it("parcial para o rotativo ou em aberto", () => {
    expect(planoDePagarFatura({ ...base, valor: 30000, resto: "rotativo" })).toMatchObject({ pagamento: 30000, rolado: 70000, emAberto: 0 });
    expect(planoDePagarFatura({ ...base, valor: 30000, resto: "depois" })).toMatchObject({ pagamento: 30000, rolado: 0, emAberto: 70000 });
  });
  it("fatura já paga é recusada", () => {
    expect(() => planoDePagarFatura({ ...base, restante: 0, valor: 1, resto: "depois" })).toThrow("Esta fatura já está paga.");
  });
});

describe("pagar dívida (§7.10)", () => {
  it("juros do mês por padrão; juros informados acima do valor ficam iguais ao valor", () => {
    const base = { dividaNome: "Caixa", saldo: 100000, jurosMesPct: 2, valor: 30000, data: "2026-09-10", contaId: "c1", categoriaDividasId: "dj" };
    expect(planoDePagarDivida(base)).toMatchObject({ juros: 2000, abatimento: 28000, lancamento: { fixo: true, descricao: "Pagamento Caixa" } });
    expect(planoDePagarDivida({ ...base, juros: 99999 })).toMatchObject({ juros: 30000, abatimento: 0 });
  });
});

describe("item de meta (§6.5.4)", () => {
  const item: ItemDeMetaParaLancar = { id: "i1", nome: "Porcelanato", valor: 100000, status: "contratado", forma: "cartao", parcelas: 3, primeiroVenc: "2026-10-05", contaId: null, cartaoId: "nu" };
  const ctx = { metaId: "m1", categoriaId: "proj", contaPadraoId: "c1", hoje: "2026-09-26", grupo };
  it("contratado no cartão gera parcelas ligadas à meta", () => {
    const ls = lancamentosDoItem(item, ctx);
    expect(ls.map((l) => l.valor)).toEqual([33334, 33333, 33333]);
    expect(ls[0]).toMatchObject({ cartaoId: "nu", metaId: "m1", metaItemId: "i1", descricao: "Porcelanato (1/3)" });
  });
  it("planejado, orçado ou sem valor não geram nada; boleto vai para a conta", () => {
    expect(lancamentosDoItem({ ...item, status: "orcado" }, ctx)).toEqual([]);
    expect(lancamentosDoItem({ ...item, valor: 0 }, ctx)).toEqual([]);
    const [l] = lancamentosDoItem({ ...item, forma: "boleto", parcelas: 1, primeiroVenc: null }, ctx);
    expect(l).toMatchObject({ contaId: "c1", cartaoId: null, data: "2026-09-26", descricao: "Porcelanato", parcelaDe: null });
  });
});

describe("padrões", () => {
  it("modelos com a contagem do PRD e paleta que recomeça", () => {
    expect(itensDoModelo("imovel")).toHaveLength(13);
    expect(itensDoModelo("reforma")).toHaveLength(67);
    expect(itensDoModelo("imovel-reforma")).toHaveLength(80);
    expect(corDaVez(12)).toBe(PALETA[0]);
  });
});
