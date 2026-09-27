import { describe, expect, it } from "vitest";
import { lerExtrato, regraAprendida, separarDuplicatas } from "./extrato";

describe("lerExtrato · OFX", () => {
  it("lê transações OFX por STMTTRN, negativo é saída e positivo é entrada", () => {
    const ofx = `
      <OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
      <STMTTRN>
        <TRNTYPE>DEBIT
        <DTPOSTED>20260910120000[-3:BRT]
        <TRNAMT>-45.90
        <MEMO>MERCADO DA ESQUINA
      </STMTTRN>
      <STMTTRN>
        <TRNTYPE>CREDIT
        <DTPOSTED>20260911
        <TRNAMT>1200.00
        <NAME>SALARIO
      </STMTTRN>
      <STMTTRN>
        <TRNTYPE>DEBIT
        <DTPOSTED>20260912
        <TRNAMT>0.00
        <MEMO>TARIFA ZERADA
      </STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
    `;
    const linhas = lerExtrato(ofx);
    expect(linhas).toEqual([
      { data: "2026-09-10", valor: 4590, tipo: "despesa", descricao: "MERCADO DA ESQUINA" },
      { data: "2026-09-11", valor: 120000, tipo: "receita", descricao: "SALARIO" },
    ]);
  });
});

describe("lerExtrato · CSV", () => {
  it("detecta separador ';' e lê data/valor/descrição", () => {
    const csv = ["data;descricao;valor", "2026-09-10;Mercado da esquina;-45,90", "2026-09-11;Salário;1.200,00"].join("\n");
    const linhas = lerExtrato(csv);
    expect(linhas).toEqual([
      { data: "2026-09-10", valor: 4590, tipo: "despesa", descricao: "Mercado da esquina" },
      { data: "2026-09-11", valor: 120000, tipo: "receita", descricao: "Salário" },
    ]);
  });

  it("detecta separador ',' quando não há ';'", () => {
    const csv = ["data,descricao,valor", "10/09/2026,Farmacia,45.90"].join("\n");
    const linhas = lerExtrato(csv);
    expect(linhas).toEqual([{ data: "2026-09-10", valor: 4590, tipo: "receita", descricao: "Farmacia" }]);
  });

  it("entende dd/mm/aa e aaaammdd", () => {
    const csv = ["10/09/26;Compra;-10,00", "20260910;Outra compra;-20,00"].join("\n");
    const linhas = lerExtrato(csv);
    expect(linhas[0]!.data).toBe("2026-09-10");
    expect(linhas[1]!.data).toBe("2026-09-10");
  });

  it("remove aspas em volta das colunas e ignora linha sem data ou sem valor (cabeçalho some sozinho)", () => {
    const csv = ['"data";"descricao";"valor"', '"2026-09-10";"Compra ""especial""";"-30,00"'].join("\n");
    const linhas = lerExtrato(csv);
    expect(linhas).toEqual([{ data: "2026-09-10", valor: 3000, tipo: "despesa", descricao: 'Compra "especial"' }]);
  });

  it("nada encontrado devolve lista vazia", () => {
    expect(lerExtrato("isso não é um extrato")).toEqual([]);
  });

  it("valor da última coluna para a primeira, pulando a coluna de data", () => {
    // banco que exporta id;data;descricao;saldo;valor: o valor certo é o da última coluna
    const csv = "1;2026-09-10;Compra no mercado;500,00;-45,90";
    const linhas = lerExtrato(csv);
    expect(linhas[0]).toEqual({ data: "2026-09-10", valor: 4590, tipo: "despesa", descricao: "Compra no mercado" });
  });
});

describe("separarDuplicatas", () => {
  const linhas = [
    { data: "2026-09-10", valor: 4590, tipo: "despesa" as const, descricao: "Mercado da esquina" },
    { data: "2026-09-11", valor: 120000, tipo: "receita" as const, descricao: "Salário" },
  ];

  it("mesma data, valor e descrição (sem diferenciar maiúsculas) é duplicata", () => {
    const existentes = [{ data: "2026-09-10", valor: 4590, descricao: "MERCADO DA ESQUINA" }];
    const { novas, repetidas } = separarDuplicatas(linhas, existentes);
    expect(repetidas).toEqual([linhas[0]]);
    expect(novas).toEqual([linhas[1]]);
  });

  it("descrição diferente não é duplicata mesmo com data e valor iguais", () => {
    const existentes = [{ data: "2026-09-10", valor: 4590, descricao: "Outra coisa" }];
    const { novas, repetidas } = separarDuplicatas(linhas, existentes);
    expect(repetidas).toEqual([]);
    expect(novas).toEqual(linhas);
  });

  it("sem existentes, tudo é novo", () => {
    const { novas, repetidas } = separarDuplicatas(linhas, []);
    expect(novas).toEqual(linhas);
    expect(repetidas).toEqual([]);
  });
});

describe("regraAprendida", () => {
  it("primeira palavra com mais de 3 letras", () => {
    expect(regraAprendida("IFOOD *PEDIDO 123")).toBe("IFOOD");
    expect(regraAprendida("Uber *Trip")).toBe("Uber");
  });

  it("pula palavras curtas até achar uma com mais de 3 letras", () => {
    expect(regraAprendida("a de um posto shell")).toBe("posto");
  });

  it("sem nenhuma palavra longa o bastante, devolve null", () => {
    expect(regraAprendida("a de um")).toBe(null);
  });
});
