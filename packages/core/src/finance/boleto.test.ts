import { describe, expect, it } from "vitest";
import { acharLinhaNoTexto, lerLinhaDigitavel } from "./boleto";

const HOJE = "2026-09-27";

// fator 1600 reconstrói 2026-10-15 depois de UM reinício de 9000 dias (ver o
// cálculo em anexo no report do subagente: base 1997-10-07 + 1600 dias cai em
// 2002, mais de 1.100 dias no passado de 2026-09-27, soma 9.000 e chega em
// 2026-10-15).
const D47_VALIDO = "000" + "0".repeat(30) + "1600" + "0000004590"; // fator 1600, valor 4.590 centavos (R$ 45,90)

// código de barras de arrecadação (44 dígitos): "8" + segmento "1" +
// identificador de valor "6" + DV "0" + valor 11 dígitos "00000012345"
// (12.345 centavos = R$ 123,45) + preenchimento de zeros.
const D48_VALIDO = "816000000019234500000009000000000009000000000009";

describe("lerLinhaDigitavel", () => {
  it("lê boleto bancário de 47 dígitos: valor e vencimento exatos", () => {
    const r = lerLinhaDigitavel(D47_VALIDO, HOJE);
    expect(r).toEqual({ valor: 4590, vencimento: "2026-10-15", tipo: "bancario" });
  });

  it("aceita pontos, espaços e traços na linha bancária", () => {
    const comSeparadores = D47_VALIDO.replace(/(.{5})/g, "$1.").replace(/\.$/, "");
    const r = lerLinhaDigitavel(comSeparadores, HOJE);
    expect(r?.valor).toBe(4590);
  });

  it("fator zero não gera vencimento, mas o valor continua válido", () => {
    const d47 = "0".repeat(33) + "0000" + "0000010000"; // fator 0, valor 100,00
    const r = lerLinhaDigitavel(d47, HOJE);
    expect(r).toEqual({ valor: 10000, vencimento: null, tipo: "bancario" });
  });

  it("valor zero é inválido", () => {
    const d47 = "0".repeat(33) + "1600" + "0000000000";
    expect(lerLinhaDigitavel(d47, HOJE)).toBe(null);
  });

  it("valor acima de 5 milhões é inválido", () => {
    const d47 = "0".repeat(33) + "1600" + "9999999999"; // bem acima de 500_000_000 centavos
    expect(lerLinhaDigitavel(d47, HOJE)).toBe(null);
  });

  it("menos de 47 dígitos é inválido", () => {
    expect(lerLinhaDigitavel("123456", HOJE)).toBe(null);
  });

  it("lê boleto de arrecadação de 48 dígitos (identificador de valor 6)", () => {
    const r = lerLinhaDigitavel(D48_VALIDO, HOJE);
    expect(r).toEqual({ valor: 12345, vencimento: null, tipo: "arrecadacao" });
  });

  it("identificador de valor 8 também é valor efetivo", () => {
    const codigoBarras = "8" + "2" + "8" + "0" + "00000099900" + "0".repeat(29);
    const blocos = [codigoBarras.slice(0, 11), codigoBarras.slice(11, 22), codigoBarras.slice(22, 33), codigoBarras.slice(33, 44)];
    const d48 = blocos.map((b) => `${b}9`).join("");
    expect(lerLinhaDigitavel(d48, HOJE)).toEqual({ valor: 99900, vencimento: null, tipo: "arrecadacao" });
  });

  it("identificador de valor de referência (9) não é suportado e devolve null", () => {
    const codigoBarras = "8" + "1" + "9" + "0" + "00000012345" + "0".repeat(29);
    const blocos = [codigoBarras.slice(0, 11), codigoBarras.slice(11, 22), codigoBarras.slice(22, 33), codigoBarras.slice(33, 44)];
    const d48 = blocos.map((b) => `${b}9`).join("");
    expect(lerLinhaDigitavel(d48, HOJE)).toBe(null);
  });
});

describe("acharLinhaNoTexto", () => {
  it("acha a linha digitável e o beneficiário dentro do texto extraído do PDF", () => {
    const texto = `
      BANCO EXEMPLO S.A.
      Cedente: Empresa Teste Ltda
      Linha digitável: ${D47_VALIDO.replace(/(.{5})/g, "$1 ")}
      Vencimento no verso.
    `;
    const r = acharLinhaNoTexto(texto, HOJE);
    expect(r?.leitura).toEqual({ valor: 4590, vencimento: "2026-10-15", tipo: "bancario" });
    expect(r?.beneficiario).toBe("Empresa Teste Ltda");
  });

  it("sem nenhuma sequência de dígitos válida, devolve null", () => {
    expect(acharLinhaNoTexto("Documento sem nenhum código de barras aqui.", HOJE)).toBe(null);
  });

  it("prefere a leitura com vencimento quando há mais de uma candidata", () => {
    const semVencimento = "0".repeat(33) + "0000" + "0000001000";
    const texto = `${semVencimento} lixo ${D47_VALIDO}`;
    const r = acharLinhaNoTexto(texto, HOJE);
    expect(r?.leitura.vencimento).toBe("2026-10-15");
  });
});
