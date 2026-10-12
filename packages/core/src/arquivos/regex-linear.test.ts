import { describe, expect, it, vi } from "vitest";

vi.mock("@orbita/db", () => ({ db: {} }));

import { linksDeDocumento, semPontuacaoFinal } from "./leitores/html";
import { rtfParaTexto } from "./leitores/office";
import { lerVcf } from "./leitores/estruturado";
import { dominioDoRemetente } from "../anexos/senhas";
import { acharLinhaNoTexto } from "../finance/boleto";

/**
 * B2 e M1 da auditoria de 11/10/2026: regex com `+$` (ou `\s*…\s*` antes de uma
 * classe que também casa espaço) recomeça a varredura a cada posição e fica
 * quadrática. Texto de e-mail é de terceiro e roda no laço principal: um link
 * com 100 mil pontos parava o apps/api por um minuto. Aqui o caso patológico
 * tem de sair em menos de 1 s, e o laço tem de continuar girando.
 */

async function medir<T>(fn: () => T): Promise<{ ms: number; maiorPausaMs: number; r: T }> {
  let ultimo = Date.now();
  let maiorPausaMs = 0;
  const relogio = setInterval(() => {
    const agora = Date.now();
    maiorPausaMs = Math.max(maiorPausaMs, agora - ultimo);
    ultimo = agora;
  }, 10);
  const inicio = Date.now();
  try {
    const r = fn();
    await new Promise((ok) => setTimeout(ok, 30));
    return { ms: Date.now() - inicio, maiorPausaMs: Math.max(maiorPausaMs, Date.now() - ultimo), r };
  } finally {
    clearInterval(relogio);
  }
}

describe("links do e-mail sem custo quadrático (B2)", () => {
  it("link do Drive com 100 mil pontos e uma letra sai em menos de 1 s", async () => {
    const corpo = `veja https://drive.google.com/${".".repeat(100_000)}a fim`;
    const m = await medir(() => linksDeDocumento(corpo, [`https://drive.google.com/x${".".repeat(100_000)}b`]));
    expect(m.ms).toBeLessThan(1000);
    expect(m.maiorPausaMs).toBeLessThan(1000);
    // o link vem cortado no teto por URL, nunca com 100 mil caracteres
    for (const l of m.r) expect(l.length).toBeLessThanOrEqual(2048);
  });

  it("40 mil pontos no FIM do link também é linear", async () => {
    const m = await medir(() => linksDeDocumento("", [`https://drive.google.com/d/abc${".".repeat(40_000)}`]));
    expect(m.ms).toBeLessThan(1000);
    expect(m.r).toEqual(["https://drive.google.com/d/abc"]);
  });

  it("o comportamento de sempre continua: pontuação final sai, link de fora fica fora", () => {
    expect(linksDeDocumento("abra https://docs.google.com/document/d/1;. e https://exemplo.com/x.")).toEqual(["https://docs.google.com/document/d/1"]);
    expect(semPontuacaoFinal("abc.,;", ".,;")).toBe("abc");
    expect(semPontuacaoFinal("abc", ".,;")).toBe("abc");
    expect(semPontuacaoFinal("...", ".")).toBe("");
  });
});

describe("domínio do remetente sem custo quadrático (B2)", () => {
  it("From com 40 mil espaços e sinais no meio sai em menos de 1 s", async () => {
    const m = await medir(() => dominioDoRemetente(`a@b${" >".repeat(20_000)}x.com`));
    expect(m.ms).toBeLessThan(1000);
    expect(m.maiorPausaMs).toBeLessThan(1000);
  });

  it("From com 40 mil '<' sem '>' também", async () => {
    const m = await medir(() => dominioDoRemetente(`${"<".repeat(40_000)}a@nubank.com.br`));
    expect(m.ms).toBeLessThan(1000);
  });

  it("os casos de sempre", () => {
    expect(dominioDoRemetente("Nubank <todomundo@nubank.com.br>")).toBe("nubank.com.br");
    expect(dominioDoRemetente("todomundo@Nubank.com.br  ")).toBe("nubank.com.br");
    expect(dominioDoRemetente("x@nubank.com.br>>")).toBe("nubank.com.br");
    expect(dominioDoRemetente("sem arroba")).toBeNull();
    expect(dominioDoRemetente(null)).toBeNull();
  });
});

// a mesma linha válida do boleto.test.ts: fator 1600 (vence 2026-10-15), R$ 45,90
const LINHA = ("000" + "0".repeat(30) + "1600" + "0000004590").replace(/(.{5})/g, "$1 ");
const HOJE = "2026-09-27";

describe("RTF, VCF e boleto sem custo quadrático (M1)", () => {
  it("linha de RTF com 40 mil tabs e uma letra", async () => {
    const m = await medir(() => rtfParaTexto(`{\\rtf1 ${"\\tab ".repeat(40_000)}x\\par fim}`));
    expect(m.ms).toBeLessThan(1000);
    expect(m.r).toContain("fim");
  });

  it("ORG do VCF com 40 mil ';' no meio", async () => {
    const vcf = `BEGIN:VCARD\nFN:Ana\nORG:Empresa${";".repeat(40_000)}x\nEND:VCARD\n`;
    const m = await medir(() => lerVcf(vcf));
    expect(m.ms).toBeLessThan(1000);
    expect(lerVcf("BEGIN:VCARD\nFN:Ana\nORG:Empresa;;\nEND:VCARD\n")[0]!.empresa).toBe("Empresa");
  });

  it("'cedente' seguido de 40 mil tabs não trava a busca do beneficiário", async () => {
    const m = await medir(() => acharLinhaNoTexto(`Linha: ${LINHA}\nCedente${"\t".repeat(40_000)}#`, HOJE));
    expect(m.ms).toBeLessThan(1000);
    expect(m.maiorPausaMs).toBeLessThan(1000);
  });

  it("o beneficiário de sempre continua saindo", () => {
    expect(acharLinhaNoTexto(`Beneficiário: ENEL DISTRIBUICAO SP\n${LINHA}`, HOJE)?.beneficiario).toBe("ENEL DISTRIBUICAO SP");
    expect(acharLinhaNoTexto(`Cedente - Empresa Teste Ltda\n${LINHA}`, HOJE)?.beneficiario).toBe("Empresa Teste Ltda");
  });
});
