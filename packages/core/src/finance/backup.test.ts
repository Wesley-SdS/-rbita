import { describe, expect, it } from "vitest";
import { exportarBackup, planoDeRestauracao, type BackupAntigo } from "./backup";
import type { DadosFinanceiros } from "./dados";
import type { FinConta, FinCartao, FinCategoria, FinLancamento, FinCompromisso, FinDivida, FinDividaPagamento, FinDividaRolagem, FinMeta, FinMetaItem, FinAtalho, FinRegra } from "@orbita/db/finance-schema";

const userId = "dono-teste";

/** Gera "n0", "n1", ... previsível: só para os testes conseguirem achar o id novo de algo que criaram. */
function fabricaDeIds(prefixo = "n") {
  let i = 0;
  return () => `${prefixo}${i++}`;
}

// ── ida e volta (exportar → restaurar) ──────────────────────────────────────

describe("exportarBackup + planoDeRestauracao · ida e volta", () => {
  function montarDados(): DadosFinanceiros {
    const conta1: FinConta = { id: "conta-1", userId, nome: "Conta corrente", tipo: "corrente", saldoInicial: 500000, cor: "#0E5A5E", ordem: 0 };
    const conta2: FinConta = { id: "conta-2", userId, nome: "Dinheiro", tipo: "dinheiro", saldoInicial: 0, cor: "#8E5D0C", ordem: 1 };
    const cartao1: FinCartao = { id: "cartao-1", userId, nome: "Nubank", limite: 300000, fechamento: 5, vencimento: 15, contaPagamentoId: "conta-1", cor: "#A6382B", ordem: 0 };
    const catMercado: FinCategoria = { id: "cat-mercado", userId, nome: "Mercado", tipo: "despesa", cor: "#1B6B45", orcamento: 100000, ordem: 0 };
    const catSalario: FinCategoria = { id: "cat-salario", userId, nome: "Salário", tipo: "receita", cor: "#4A5EA8", orcamento: 0, ordem: 1 };
    const catTransfSaida: FinCategoria = { id: "cat-ts", userId, nome: "Transferência", tipo: "despesa", cor: "#333", orcamento: 0, ordem: 2 };
    const catTransfEntrada: FinCategoria = { id: "cat-te", userId, nome: "Transferência", tipo: "receita", cor: "#333", orcamento: 0, ordem: 3 };

    const lancMercado: FinLancamento = {
      id: "l-mercado", userId, tipo: "despesa", data: "2026-09-10", valor: 4590, descricao: "Mercado da esquina",
      categoriaId: catMercado.id, contaId: conta1.id, cartaoId: null, transferencia: false, grupoTransferencia: null,
      fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null, metaId: null, metaItemId: null,
      compromissoId: null, importado: false, criadoEm: new Date("2026-09-10T12:00:00.000Z"),
    };
    const lancCartao: FinLancamento = {
      id: "l-cartao", userId, tipo: "despesa", data: "2026-09-03", valor: 12000, descricao: "Farmácia",
      categoriaId: catMercado.id, contaId: null, cartaoId: cartao1.id, transferencia: false, grupoTransferencia: null,
      fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null, metaId: null, metaItemId: null,
      compromissoId: null, importado: false, criadoEm: new Date("2026-09-03T09:00:00.000Z"),
    };
    const transfSaida: FinLancamento = {
      id: "l-transf-saida", userId, tipo: "despesa", data: "2026-09-05", valor: 20000, descricao: "Transferência",
      categoriaId: catTransfSaida.id, contaId: conta1.id, cartaoId: null, transferencia: true, grupoTransferencia: "grupo-t1",
      fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null, metaId: null, metaItemId: null,
      compromissoId: null, importado: false, criadoEm: new Date("2026-09-05T10:00:00.000Z"),
    };
    const transfEntrada: FinLancamento = {
      id: "l-transf-entrada", userId, tipo: "receita", data: "2026-09-05", valor: 20000, descricao: "Transferência",
      categoriaId: catTransfEntrada.id, contaId: conta2.id, cartaoId: null, transferencia: true, grupoTransferencia: "grupo-t1",
      fixo: false, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null, metaId: null, metaItemId: null,
      compromissoId: null, importado: false, criadoEm: new Date("2026-09-05T10:00:00.000Z"),
    };
    const lancQuitacao: FinLancamento = {
      id: "l-ipva", userId, tipo: "despesa", data: "2026-08-09", valor: 50000, descricao: "IPVA",
      categoriaId: catMercado.id, contaId: conta1.id, cartaoId: null, transferencia: false, grupoTransferencia: null,
      fixo: true, estorno: false, grupoParcela: null, parcelaN: null, parcelaDe: null, metaId: null, metaItemId: null,
      compromissoId: "compromisso-ipva", importado: false, criadoEm: new Date("2026-08-09T08:00:00.000Z"),
    };

    const compromisso: FinCompromisso = {
      id: "compromisso-ipva", userId, direcao: "pagar", descricao: "IPVA", valor: 50000, vencimento: "2026-08-10",
      categoriaId: catMercado.id, contaId: conta1.id, recorrencia: "nenhuma", serieId: null, diaMes: null,
      status: "quitado", quitadoEm: "2026-08-09", lancamentoId: lancQuitacao.id, criadoEm: new Date("2026-08-01T00:00:00.000Z"),
    };

    const divida: FinDivida & { pagamentos: FinDividaPagamento[]; rolagens: FinDividaRolagem[] } = {
      id: "divida-1", userId, nome: "Empréstimo Caixa", tipo: "emprestimo", saldoInicial: 1000000, jurosMes: 2.5,
      parcelaMensal: 50000, contaId: conta1.id, cartaoId: null, criadoEm: new Date("2026-01-01T00:00:00.000Z"),
      pagamentos: [{ id: "div-pag-1", userId, dividaId: "divida-1", data: "2026-09-10", valor: 50000, juros: 25000, abatimento: 25000, lancamentoId: null }],
      rolagens: [],
    };

    const meta: FinMeta & { itens: (FinMetaItem & { fotos: number })[] } = {
      id: "meta-1", userId, nome: "Reforma", descricao: "Reforma do apê", orcamento: 5000000, cor: "#7A3B7E",
      criadoEm: new Date("2026-06-01T00:00:00.000Z"),
      itens: [
        {
          id: "item-1", userId, metaId: "meta-1", grupo: "Elétrica", nome: "Fiação", valor: 200000, status: "contratado",
          forma: "avista", parcelas: 1, primeiroVenc: "2026-09-20", contaId: conta1.id, cartaoId: null, obs: "loja X", ordem: 0,
          fotos: 1,
        },
      ],
    };

    const atalho: FinAtalho = { id: "atalho-1", userId, rotulo: "Almoço", valor: 3500, categoriaId: catMercado.id, contaId: null, cartaoId: cartao1.id, ordem: 0 };
    const regra: FinRegra = { id: "regra-1", userId, contem: "IFOOD", categoriaId: catMercado.id, ordem: 0 };

    return {
      renda: 1000000, teto: 0, boasVindasVistas: true,
      contas: [conta1, conta2], cartoes: [cartao1], categorias: [catMercado, catSalario, catTransfSaida, catTransfEntrada],
      lancamentos: [lancMercado, lancCartao, transfSaida, transfEntrada, lancQuitacao],
      compromissos: [compromisso], pagamentosFatura: [], dividas: [divida], metas: [meta], atalhos: [atalho], regras: [regra],
    };
  }

  it("preserva valores em centavos e referências cruzadas depois de exportar e restaurar", () => {
    const dados = montarDados();
    const backup = exportarBackup(dados, [{ itemId: "item-1", id: "foto-1", dado: "data:image/jpeg;base64,QUJDRA==" }]);

    // formato do app antigo: reais com ponto flutuante, não centavos
    expect(backup.renda).toBe(10000);
    expect(backup.tema).toBe("auto");
    expect(backup.rev).toBe(1);
    expect(backup.lancamentos.find((l) => l.id === "l-mercado")?.valor).toBe(45.9);

    const plano = planoDeRestauracao(backup, fabricaDeIds());

    expect(plano.perfil).toEqual({ renda: 1000000, teto: 0 });
    expect(plano.contas).toHaveLength(2);
    expect(plano.cartoes).toHaveLength(1);
    expect(plano.lancamentos).toHaveLength(5);

    const mercado = plano.lancamentos.find((l) => l.descricao === "Mercado da esquina");
    expect(mercado).toMatchObject({ valor: 4590, tipo: "despesa", transferencia: false });
    expect(mercado?.contaId).toBe(plano.contas.find((c) => c.nome === "Conta corrente")!.id);

    // as duas pernas da transferência continuam ligadas pelo MESMO grupo novo
    const pernas = plano.lancamentos.filter((l) => l.transferencia);
    expect(pernas).toHaveLength(2);
    expect(pernas[0]!.grupoTransferencia).toBe(pernas[1]!.grupoTransferencia);
    expect(pernas[0]!.grupoTransferencia).not.toBeNull();
    expect(new Set(pernas.map((p) => p.contaId))).toEqual(new Set([plano.contas[0]!.id, plano.contas[1]!.id]));

    // o compromisso quitado aponta para o MESMO lançamento novo que tem a descrição correspondente
    const lancIpva = plano.lancamentos.find((l) => l.descricao === "IPVA");
    const compromissoIpva = plano.compromissos.find((c) => c.descricao === "IPVA");
    expect(compromissoIpva?.lancamentoId).toBe(lancIpva?.id);
    expect(compromissoIpva?.status).toBe("quitado");

    // dívida: saldo, juros e abatimento em centavos
    const divida = plano.dividas[0]!;
    expect(divida).toMatchObject({ nome: "Empréstimo Caixa", saldoInicial: 1000000, jurosMes: 2.5, parcelaMensal: 50000 });
    expect(plano.dividaPagamentos[0]).toMatchObject({ dividaId: divida.id, valor: 50000, juros: 25000, abatimento: 25000 });

    // meta: item contratado com foto
    expect(plano.metas[0]).toMatchObject({ nome: "Reforma", orcamento: 5000000 });
    const item = plano.metaItens[0]!;
    expect(item).toMatchObject({ nome: "Fiação", valor: 200000, status: "contratado", primeiroVenc: "2026-09-20" });
    expect(plano.metaFotos).toHaveLength(1);
    expect(plano.metaFotos[0]).toMatchObject({ itemId: item.id, dado: "data:image/jpeg;base64,QUJDRA==" });

    // atalho no cartão: ondeId "cartao:ID" volta a apontar para o cartão certo
    expect(plano.atalhos[0]).toMatchObject({ rotulo: "Almoço", valor: 3500, cartaoId: plano.cartoes[0]!.id, contaId: null });

    expect(plano.regras[0]).toMatchObject({ contem: "IFOOD", categoriaId: plano.categorias.find((c) => c.nome === "Mercado")!.id, ordem: 0 });
  });
});

// ── um backup antigo escrito à mão, com as manhas do app antigo ────────────

function backupAntigoRealista(): BackupAntigo {
  return {
    rev: 7, tema: "escuro", renda: 8000.5, limiteMensal: 0, criadoEm: "2025-01-01",
    contas: [
      { id: "c1", nome: "Conta corrente", tipo: "corrente", saldoInicial: 1000, cor: "#0E5A5E" },
      { id: "c2", nome: "Dinheiro", tipo: "dinheiro", saldoInicial: 0, cor: "#8E5D0C" },
    ],
    cartoes: [
      { id: "cartaoA", nome: "Nubank", limite: 3000, fechamento: 5, vencimento: 15, contaPagamentoId: "c1", cor: "#A6382B" },
      { id: "cartaoB", nome: "Inter", limite: 2000, fechamento: 10, vencimento: 20, contaPagamentoId: "c1", cor: "#1B6B45" },
    ],
    categorias: [
      { id: "cat-compras", nome: "Compras", tipo: "despesa", cor: "#4A5EA8", orcamento: 0 },
      { id: "cat-delivery", nome: "Delivery e restaurante", tipo: "despesa", cor: "#7A3B7E", orcamento: 0 },
      { id: "cat-moradia", nome: "Moradia", tipo: "despesa", cor: "#2F7D8C", orcamento: 0 },
      { id: "cat-internet", nome: "Contas da casa", tipo: "despesa", cor: "#9B4A1F", orcamento: 0 },
      { id: "cat-projeto", nome: "Projeto · Reforma", tipo: "despesa", cor: "#5B6E2A", orcamento: 0 },
    ],
    lancamentos: [
      // parcelas agrupadas (grupoParcela antigo "g1"), 2 de 2, no cartaoA
      {
        id: "l1", tipo: "despesa", data: "2026-09-10", valor: 500, descricao: "Geladeira (1/2)", categoriaId: "cat-compras",
        contaId: "", cartaoId: "cartaoA", transferencia: false, grupoTransferencia: "", fixo: false, estorno: false,
        grupoParcela: "g1", parcelaN: 1, parcelaDe: 2, metaId: "", metaItemId: "", importado: false, faturaPaga: false, criadoEm: 1000,
      },
      {
        id: "l2", tipo: "despesa", data: "2026-10-10", valor: 500, descricao: "Geladeira (2/2)", categoriaId: "cat-compras",
        contaId: "", cartaoId: "cartaoA", transferencia: false, grupoTransferencia: "", fixo: false, estorno: false,
        grupoParcela: "g1", parcelaN: 2, parcelaDe: 2, metaId: "", metaItemId: "", importado: false, faturaPaga: false, criadoEm: 1001,
      },
      // transferência com duas pernas (grupoTransferencia antigo "t9")
      {
        id: "l3", tipo: "despesa", data: "2026-09-05", valor: 200, descricao: "Transferência", categoriaId: "",
        contaId: "c1", cartaoId: "", transferencia: true, grupoTransferencia: "t9", fixo: false, estorno: false,
        grupoParcela: "", parcelaN: 0, parcelaDe: 0, metaId: "", metaItemId: "", importado: false, faturaPaga: false, criadoEm: 1002,
      },
      {
        id: "l4", tipo: "receita", data: "2026-09-05", valor: 200, descricao: "Transferência", categoriaId: "",
        contaId: "c2", cartaoId: "", transferencia: true, grupoTransferencia: "t9", fixo: false, estorno: false,
        grupoParcela: "", parcelaN: 0, parcelaDe: 0, metaId: "", metaItemId: "", importado: false, faturaPaga: false, criadoEm: 1003,
      },
      // fatura antiga no cartaoB, as duas compras marcadas faturaPaga (sem pagamentoFatura correspondente)
      {
        id: "l5", tipo: "despesa", data: "2026-09-03", valor: 80, descricao: "Posto", categoriaId: "cat-compras",
        contaId: "", cartaoId: "cartaoB", transferencia: false, grupoTransferencia: "", fixo: false, estorno: false,
        grupoParcela: "", parcelaN: 0, parcelaDe: 0, metaId: "", metaItemId: "", importado: false, faturaPaga: true, criadoEm: 1004,
      },
      {
        id: "l6", tipo: "despesa", data: "2026-09-04", valor: 20, descricao: "Farmácia", categoriaId: "cat-compras",
        contaId: "", cartaoId: "cartaoB", transferencia: false, grupoTransferencia: "", fixo: false, estorno: false,
        grupoParcela: "", parcelaN: 0, parcelaDe: 0, metaId: "", metaItemId: "", importado: false, faturaPaga: true, criadoEm: 1005,
      },
      // lançamento da quitação do IPVA, referenciado pelo compromisso abaixo
      {
        id: "l-ipva", tipo: "despesa", data: "2026-08-09", valor: 500, descricao: "Pagamento IPVA", categoriaId: "cat-compras",
        contaId: "c1", cartaoId: "", transferencia: false, grupoTransferencia: "", fixo: true, estorno: false,
        grupoParcela: "", parcelaN: 0, parcelaDe: 0, metaId: "", metaItemId: "", importado: false, faturaPaga: false, criadoEm: 1006,
      },
    ],
    compromissos: [
      // conta fixa SEM serieId (campo nem existe no objeto, como um backup antigo de verdade)
      { id: "cm-aluguel", direcao: "pagar", descricao: "Aluguel", valor: 1500, vencimento: "2026-09-05", categoriaId: "cat-moradia", contaId: "c1", recorrencia: "mensal", serieId: "", diaMes: 0, status: "aberto", quitadoEm: "", lancamentoId: "" },
      // duas contas fixas "Internet" em aberto no MESMO mês: a segunda é duplicata e deve sumir
      { id: "cm-internet-1", direcao: "pagar", descricao: "Internet", valor: 120, vencimento: "2026-09-08", categoriaId: "cat-internet", contaId: "c1", recorrencia: "mensal", serieId: "", diaMes: 8, status: "aberto", quitadoEm: "", lancamentoId: "" },
      { id: "cm-internet-2", direcao: "pagar", descricao: "internet", valor: 120, vencimento: "2026-09-20", categoriaId: "cat-internet", contaId: "c1", recorrencia: "mensal", serieId: "", diaMes: 20, status: "aberto", quitadoEm: "", lancamentoId: "" },
      // quitado, aponta para o lançamento "l-ipva" acima
      { id: "cm-ipva", direcao: "pagar", descricao: "IPVA", valor: 500, vencimento: "2026-08-10", categoriaId: "cat-compras", contaId: "c1", recorrencia: "nenhuma", serieId: "", diaMes: 0, status: "quitado", quitadoEm: "2026-08-09", lancamentoId: "l-ipva" },
    ],
    pagamentosFatura: [],
    dividas: [],
    metas: [
      {
        id: "m1", nome: "Reforma", descricao: "", orcamento: 50000, prazo: "", cor: "#5B6E2A", criadoEm: "2026-06-01",
        itens: [
          {
            id: "it1", grupo: "Elétrica", nome: "Fiação", valor: 2000, status: "contratado", obs: "",
            pagamento: { forma: "avista", parcelas: 1, primeiroVenc: "2026-09-20", contaId: "c1", cartaoId: "" },
            imagens: [{ id: "img1", dado: "data:image/jpeg;base64,QUJDRA==" }],
          },
        ],
      },
    ],
    atalhos: [{ id: "at1", rotulo: "Posto", valor: 80, categoriaId: "cat-compras", ondeId: "cartao:cartaoA" }],
    regras: [{ contem: "IFOOD", categoriaId: "cat-delivery" }],
  };
}

describe("planoDeRestauracao · backup antigo escrito à mão", () => {
  it("mantém o mesmo grupo novo para as parcelas de uma compra", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const parcelas = plano.lancamentos.filter((l) => l.grupoParcela !== null);
    expect(parcelas).toHaveLength(2);
    expect(parcelas[0]!.grupoParcela).toBe(parcelas[1]!.grupoParcela);
    expect(parcelas.map((p) => p.parcelaN).sort()).toEqual([1, 2]);
    expect(parcelas.map((p) => p.valor)).toEqual([50000, 50000]);
  });

  it("mantém as duas pernas da transferência ligadas pelo mesmo grupo novo", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const pernas = plano.lancamentos.filter((l) => l.transferencia);
    expect(pernas).toHaveLength(2);
    expect(pernas[0]!.grupoTransferencia).toBe(pernas[1]!.grupoTransferencia);
    expect(pernas.map((p) => p.tipo).sort()).toEqual(["despesa", "receita"]);
  });

  it("migra faturaPaga legado: cria pagamento de fatura com o total, datado no vencimento", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const cartaoB = plano.cartoes.find((c) => c.nome === "Inter")!;
    const pagamento = plano.pagamentosFatura.find((p) => p.cartaoId === cartaoB.id);
    expect(pagamento).toBeDefined();
    // fecha dia 10; as duas compras (03/09 e 04/09) caem na fatura que fecha 10/09; vence dia 20/09
    expect(pagamento!.fechamento).toBe("2026-09-10");
    expect(pagamento!.data).toBe("2026-09-20");
    expect(pagamento!.valor).toBe(10000); // (80 + 20) reais em centavos
    expect(pagamento!.rolado).toBe(false);
    expect(pagamento!.lancamentoId).toBeNull();
  });

  it("conta fixa sem serieId vira a própria série, e diaMes ausente pega o dia do vencimento", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const aluguel = plano.compromissos.find((c) => c.descricao === "Aluguel")!;
    expect(aluguel.serieId).toBe(aluguel.id);
    expect(aluguel.diaMes).toBe(5);
  });

  it("remove duplicata de conta fixa em aberto (mesma direção, descrição e mês)", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const internets = plano.compromissos.filter((c) => c.descricao.toLowerCase() === "internet");
    expect(internets).toHaveLength(1);
    expect(internets[0]!.id).not.toBeUndefined();
  });

  it("compromisso quitado aponta para o lançamento novo correspondente", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const lancIpva = plano.lancamentos.find((l) => l.descricao === "Pagamento IPVA")!;
    const cmIpva = plano.compromissos.find((c) => c.descricao === "IPVA")!;
    expect(cmIpva.lancamentoId).toBe(lancIpva.id);
    expect(cmIpva.status).toBe("quitado");
  });

  it("meta com item contratado e imagem vira metaItem + metaFoto ligados", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    expect(plano.metas).toHaveLength(1);
    const item = plano.metaItens[0]!;
    expect(item).toMatchObject({ nome: "Fiação", valor: 2000 * 100, status: "contratado", forma: "avista", primeiroVenc: "2026-09-20" });
    expect(item.contaId).toBe(plano.contas.find((c) => c.nome === "Conta corrente")!.id);
    expect(plano.metaFotos).toEqual([{ id: expect.any(String), itemId: item.id, dado: "data:image/jpeg;base64,QUJDRA==", bytes: Math.round(("data:image/jpeg;base64,QUJDRA==".length * 3) / 4) }]);
  });

  it("atalho 'cartao:ID' resolve para o cartão certo, sem conta", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    const atalho = plano.atalhos[0]!;
    expect(atalho.cartaoId).toBe(plano.cartoes.find((c) => c.nome === "Nubank")!.id);
    expect(atalho.contaId).toBeNull();
  });

  it("renda e teto em reais viram centavos no perfil", () => {
    const plano = planoDeRestauracao(backupAntigoRealista(), fabricaDeIds());
    expect(plano.perfil).toEqual({ renda: 800050, teto: 0 });
  });

  it("regra referenciando categoria inexistente é descartada", () => {
    const backup = backupAntigoRealista();
    backup.regras.push({ contem: "UBER", categoriaId: "categoria-que-nao-existe" });
    const plano = planoDeRestauracao(backup, fabricaDeIds());
    expect(plano.regras).toHaveLength(1);
    expect(plano.regras[0]!.contem).toBe("IFOOD");
  });
});

// ── validação ────────────────────────────────────────────────────────────

describe("planoDeRestauracao · validação", () => {
  it("recusa texto que não é um objeto", () => {
    expect(() => planoDeRestauracao("isso não é um backup", fabricaDeIds())).toThrow("Esse texto não é um backup válido.");
    expect(() => planoDeRestauracao(null, fabricaDeIds())).toThrow("Esse texto não é um backup válido.");
    expect(() => planoDeRestauracao(42, fabricaDeIds())).toThrow("Esse texto não é um backup válido.");
    expect(() => planoDeRestauracao([], fabricaDeIds())).toThrow("Esse texto não é um backup válido.");
  });

  it("recusa objeto sem lista de lançamentos", () => {
    expect(() => planoDeRestauracao({ contas: [] }, fabricaDeIds())).toThrow("Backup sem lançamentos. Verifique o arquivo.");
    expect(() => planoDeRestauracao({}, fabricaDeIds())).toThrow("Backup sem lançamentos. Verifique o arquivo.");
  });
});
