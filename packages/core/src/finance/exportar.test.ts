import { describe, expect, it } from "vitest";
import { lancamentosCsv, type LinhaLancamentoCsv } from "./exportar";

describe("lancamentosCsv", () => {
  it("gera cabeçalho, separador ';', vírgula decimal, CRLF e BOM", () => {
    const linhas: LinhaLancamentoCsv[] = [
      {
        data: "2026-09-10",
        tipo: "despesa",
        valor: 4590,
        descricao: "Mercado",
        categoria: "Mercado",
        conta: "Conta corrente",
        cartao: null,
        transferencia: false,
      },
    ];
    const csv = lancamentosCsv(linhas);

    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const semBom = csv.slice(1);
    const [cabecalho, linha1] = semBom.split("\r\n");
    expect(cabecalho).toBe('"data";"tipo";"valor";"descricao";"categoria";"conta";"cartao";"transferencia"');
    expect(linha1).toBe('"2026-09-10";"despesa";"45,90";"Mercado";"Mercado";"Conta corrente";"";"nao"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.includes("\n") && !csv.includes("\r\n")).toBe(false); // toda quebra é CRLF
  });

  it("duplica aspas internas e marca cartão/transferência", () => {
    const linhas: LinhaLancamentoCsv[] = [
      {
        data: "2026-09-11",
        tipo: "despesa",
        valor: 100000,
        descricao: 'Compra "especial"',
        categoria: "Compras",
        conta: null,
        cartao: "Nubank",
        transferencia: true,
      },
    ];
    const csv = lancamentosCsv(linhas);
    expect(csv).toContain('"Compra ""especial"""');
    expect(csv).toContain('"Nubank"');
    expect(csv).toContain('"sim"');
  });

  it("ordena por data mesmo que chegue fora de ordem", () => {
    const base = { tipo: "despesa" as const, descricao: "x", categoria: "Outros gastos", conta: "Conta", cartao: null, transferencia: false };
    const csv = lancamentosCsv([
      { ...base, data: "2026-09-15", valor: 100 },
      { ...base, data: "2026-09-01", valor: 200 },
    ]);
    const linhas = csv.split("\r\n").filter(Boolean);
    expect(linhas[1]).toContain("2026-09-01");
    expect(linhas[2]).toContain("2026-09-15");
  });

  it("sem lançamentos, gera só o cabeçalho", () => {
    const csv = lancamentosCsv([]);
    expect(csv).toBe(`﻿"data";"tipo";"valor";"descricao";"categoria";"conta";"cartao";"transferencia"\r\n`);
  });

  it("valor negativo (defensivo) mantém o sinal e as duas casas", () => {
    const linhas: LinhaLancamentoCsv[] = [
      { data: "2026-09-10", tipo: "despesa", valor: -5, descricao: "x", categoria: "y", conta: null, cartao: null, transferencia: false },
    ];
    expect(lancamentosCsv(linhas)).toContain('"-0,05"');
  });
});
