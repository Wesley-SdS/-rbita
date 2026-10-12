import { describe, expect, it } from "vitest";
import { normalizarTransacao, type TransacaoBruta } from "./normalizar";
import { planejar, saldoInicialParaBater, type EntradaDoPlano, type PernaSolta } from "./plano";
import type { TxBanco } from "./normalizar";

const tx = (p: Partial<TxBanco> & Pick<TxBanco, "pluggyId" | "contaRef" | "natureza" | "valor" | "data">): TxBanco => ({
  descricao: "x", propria: false, terceiro: false, ...p,
});

let n = 0;
const entrada = (p: Partial<EntradaDoPlano> & Pick<EntradaDoPlano, "novas">): EntradaDoPlano => ({
  soltas: [], manuais: [],
  contaDe: new Map([["A", "conta-a"], ["B", "conta-b"]]),
  janelaDias: 2, diasRepetido: 2, reconhecerTransferencias: true,
  compararComManuais: new Set(), novoGrupo: () => `g${++n}`,
  ...p,
});

describe("normalizarTransacao", () => {
  const base: TransacaoBruta = { id: "t1", date: "2026-10-09T00:00:00.000Z", amount: -45.9, type: "DEBIT", status: "POSTED", description: "Mercado", currencyCode: "BRL" };

  it("converte reais em centavos inteiros e usa o dia do texto da data, sem fuso", () => {
    expect(normalizarTransacao(base, "A", null)).toMatchObject({ valor: 4590, natureza: "despesa", data: "2026-10-09" });
    // 0,1 + 0,2 em ponto flutuante: o arredondamento tem de fechar o centavo
    expect(normalizarTransacao({ ...base, amount: 0.29, type: "CREDIT" }, "A", null)?.valor).toBe(29);
  });

  it("descarta o que não deve virar lançamento", () => {
    expect(normalizarTransacao({ ...base, status: "PENDING" }, "A", null)).toBeNull();
    expect(normalizarTransacao({ ...base, currencyCode: "USD" }, "A", null)).toBeNull();
    expect(normalizarTransacao({ ...base, amount: 0 }, "A", null)).toBeNull();
    expect(normalizarTransacao({ ...base, date: "ontem" }, "A", null)).toBeNull();
  });

  it("reconhece transferência para si mesmo pelo documento dos dois lados", () => {
    const eu = { documentNumber: { type: "CPF", value: "333.333.333-33" } };
    const r = normalizarTransacao({ ...base, paymentData: { payer: eu, receiver: eu } }, "A", "33333333333");
    expect(r).toMatchObject({ propria: true, terceiro: false });
  });

  it("um terceiro do outro lado nunca é transferência própria", () => {
    const eu = { documentNumber: { type: "CPF", value: "33333333333" } };
    const maria = { name: "Maria", documentNumber: { type: "CPF", value: "11111111111" } };
    const r = normalizarTransacao({ ...base, paymentData: { payer: eu, receiver: maria } }, "A", "33333333333");
    expect(r).toMatchObject({ propria: false, terceiro: true });
    // compra em loja também é terceiro
    expect(normalizarTransacao({ ...base, merchant: { name: "Padaria" } }, "A", null)?.terceiro).toBe(true);
  });

  it("sem o documento do titular, o próprio CPF do pagador num débito não vira terceiro", () => {
    const eu = { documentNumber: { type: "CPF", value: "33333333333" } };
    expect(normalizarTransacao({ ...base, paymentData: { payer: eu, receiver: null } }, "A", null)?.terceiro).toBe(false);
  });
});

describe("planejar · transferência entre contas", () => {
  const saida = tx({ pluggyId: "s1", contaRef: "A", natureza: "despesa", valor: 50000, data: "2026-10-09" });
  const entradaB = tx({ pluggyId: "e1", contaRef: "B", natureza: "receita", valor: 50000, data: "2026-10-09" });

  it("saída numa conta e entrada na outra, mesmo valor e dia, viram UMA transferência (mesmo grupo)", () => {
    const r = planejar(entrada({ novas: [saida, entradaB] }));
    expect(r).toHaveLength(2);
    expect(r.every((d) => d.acao === "transferencia")).toBe(true);
    const grupos = new Set(r.map((d) => (d.acao === "transferencia" ? d.grupo : "")));
    expect(grupos.size).toBe(1);
  });

  it("CONTROLE: mesmo valor na MESMA conta, ou valor diferente, continua sendo gasto e renda", () => {
    expect(planejar(entrada({ novas: [saida, { ...entradaB, contaRef: "A" }] })).map((d) => d.acao)).toEqual(["lancar", "lancar"]);
    expect(planejar(entrada({ novas: [saida, { ...entradaB, valor: 49999 }] })).map((d) => d.acao)).toEqual(["lancar", "lancar"]);
  });

  it("o Pix demora um dia para cair: a janela de dias ainda casa, e passando dela não casa", () => {
    expect(planejar(entrada({ novas: [saida, { ...entradaB, data: "2026-10-11" }] })).every((d) => d.acao === "transferencia")).toBe(true);
    expect(planejar(entrada({ novas: [saida, { ...entradaB, data: "2026-10-12" }] })).map((d) => d.acao)).toEqual(["lancar", "lancar"]);
  });

  it("terceiro identificado de qualquer lado impede o par (pagar R$ 500 e receber R$ 500 de um amigo)", () => {
    const amigo = { ...entradaB, terceiro: true };
    expect(planejar(entrada({ novas: [saida, amigo] })).map((d) => d.acao)).toEqual(["lancar", "lancar"]);
  });

  it("duas saídas iguais e uma entrada: só UMA saída vira transferência", () => {
    const outra = { ...saida, pluggyId: "s2" };
    const r = planejar(entrada({ novas: [saida, outra, entradaB] }));
    expect(r.filter((d) => d.acao === "transferencia")).toHaveLength(2);
    expect(r.filter((d) => d.acao === "lancar")).toHaveLength(1);
  });

  it("um lado chegou antes: a perna antiga é reclassificada e só a nova nasce como transferência", () => {
    const antiga: PernaSolta = { ...saida, lancamentoId: "lanc-antigo" };
    const r = planejar(entrada({ novas: [entradaB], soltas: [antiga] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ acao: "transferencia", par: { pluggyId: "s1", lancamentoId: "lanc-antigo" } });
  });

  it("duas pernas antigas nunca casam entre si (não há linha nova para sustentar)", () => {
    const a: PernaSolta = { ...saida, lancamentoId: "l1" };
    const b: PernaSolta = { ...entradaB, lancamentoId: "l2" };
    expect(planejar(entrada({ novas: [], soltas: [a, b] }))).toEqual([]);
  });

  it("perna única: o banco diz que os dois lados são o dono, e a outra conta não está sincronizada", () => {
    const sozinha = { ...saida, propria: true };
    expect(planejar(entrada({ novas: [sozinha] }))[0]).toMatchObject({ acao: "transferencia_solta" });
  });

  it("reconhecimento desligado: tudo vira lançamento comum, até a que o banco marcou como própria", () => {
    const r = planejar(entrada({ novas: [{ ...saida, propria: true }, entradaB], reconhecerTransferencias: false }));
    expect(r.map((d) => d.acao)).toEqual(["lancar", "lancar"]);
  });
});

describe("planejar · o que já estava lançado à mão", () => {
  const linha = tx({ pluggyId: "s1", contaRef: "A", natureza: "despesa", valor: 3200, data: "2026-10-09" });
  const manual = { id: "m1", natureza: "despesa" as const, data: "2026-10-09", valor: 3200, contaId: "conta-a" };

  it("não duplica: a linha casa com o lançamento manual da mesma conta, valor e dia", () => {
    const r = planejar(entrada({ novas: [linha], manuais: [manual], compararComManuais: new Set(["A"]) }));
    expect(r[0]).toMatchObject({ acao: "ja_existia", lancamentoId: "m1" });
  });

  it("um lançamento manual cobre UMA linha só: o segundo café idêntico continua entrando", () => {
    const r = planejar(entrada({ novas: [linha, { ...linha, pluggyId: "s2" }], manuais: [manual], compararComManuais: new Set(["A"]) }));
    expect(r.map((d) => d.acao).sort()).toEqual(["ja_existia", "lancar"]);
  });

  it("CONTROLE: conta nova (sem comparação) lança tudo, e conta diferente não casa", () => {
    expect(planejar(entrada({ novas: [linha], manuais: [manual] }))[0]!.acao).toBe("lancar");
    expect(planejar(entrada({ novas: [linha], manuais: [{ ...manual, contaId: "conta-b" }], compararComManuais: new Set(["A"]) }))[0]!.acao).toBe("lancar");
  });

  it("transferência que o dono já lançou à mão (as duas pernas) não vira outra transferência", () => {
    const manualB = { id: "m2", natureza: "receita" as const, data: "2026-10-09", valor: 50000, contaId: "conta-b" };
    const manualA = { id: "m1", natureza: "despesa" as const, data: "2026-10-09", valor: 50000, contaId: "conta-a" };
    const saida = tx({ pluggyId: "s1", contaRef: "A", natureza: "despesa", valor: 50000, data: "2026-10-09" });
    const ent = tx({ pluggyId: "e1", contaRef: "B", natureza: "receita", valor: 50000, data: "2026-10-09" });
    const r = planejar(entrada({ novas: [saida, ent], manuais: [manualA, manualB], compararComManuais: new Set(["A", "B"]) }));
    expect(r.map((d) => d.acao)).toEqual(["ja_existia", "ja_existia"]);
  });
});

describe("saldoInicialParaBater", () => {
  it("o saldo inicial é o saldo do banco menos o efeito do que foi importado", () => {
    // banco diz R$ 1.000,00; entrou 300 e saiu 50 na janela: antes da janela havia 750
    expect(saldoInicialParaBater(100000, [{ natureza: "receita", valor: 30000 }, { natureza: "despesa", valor: 5000 }])).toBe(75000);
  });
  it("sem nada importado, o saldo inicial é o próprio saldo do banco", () => {
    expect(saldoInicialParaBater(12345, [])).toBe(12345);
  });
});
