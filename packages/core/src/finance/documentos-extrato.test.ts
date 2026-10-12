import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

/**
 * O extrato que chega por e-mail (`usar_anexo`) ou pelo WhatsApp vira o trabalho
 * `financas.extrato`, que chama `importStatement`. Depois da auditoria de
 * 11/10/2026 (I8, I7): OFX, CSV e planilha são lidos pelo leitor DETERMINÍSTICO
 * (`finance/extrato.ts`, o mesmo da tela), com TODAS as linhas; o modelo só
 * entra para PDF e imagem. Número de dinheiro sai do motor (CLAUDE.md §9).
 */

vi.mock("@orbita/db", () => ({ db: {} }));
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await import("../settings/defs");
  const valor = (k: string) => (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default;
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
const modelo = vi.hoisted(() => ({ chamado: 0 }));
vi.mock("../llm/gerar", () => ({
  modeloDaCasa: async () => {
    modelo.chamado++;
    return { model: {}, modelKey: "teste" };
  },
}));
const gerado = vi.hoisted(() => vi.fn(async () => ({ lancamentos: [{ descricao: "Padaria", valor: 12.5, tipo: "expense", data: "2026-10-01", categoria: "" }] })));
vi.mock("../meetings/structured", () => ({ generateStructured: gerado }));
vi.mock("../usage/registrar", () => ({ registrarUso: vi.fn(), FLUXO: { financas: "financas" } }));
vi.mock("./store", () => ({
  hojeDoServidor: () => "2026-10-11",
  carregar: async () => ({ lancamentos: [{ data: "2026-10-01", valor: 1000, descricao: "Já lançado" }], categorias: [], regras: [] }),
}));
const executar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ id: "x" })));
vi.mock("./comandos", () => ({ executar }));
vi.mock("../ocr/tesseract", () => ({ ocrImagem: vi.fn(async () => null), ocrImage: vi.fn(), encerrarOcr: vi.fn(), confiancaDaPagina: vi.fn() }));
vi.mock("../ocr/visao", () => ({ lerComVisao: vi.fn(async () => null), ondeLer: vi.fn() }));

import { importStatement } from "./documents";

const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;
type Importar = { tipo: string; linhas: { data: string; valor: number; natureza: string; descricao: string }[] };

beforeEach(() => {
  vi.clearAllMocks();
  modelo.chamado = 0;
});

describe("extrato pelo motor, não pelo modelo (I8)", () => {
  it("CSV de 2.500 linhas: todas importadas, valor em centavos exato, sem chamar modelo nenhum (e sem o corte de anexos.linhasMax, I7)", async () => {
    const linhas = ["Data;Descrição;Valor"];
    for (let i = 0; i < 2500; i++) linhas.push(`${String((i % 28) + 1).padStart(2, "0")}/09/2026;Compra ${i};-${(i + 1).toString()},${String(i % 100).padStart(2, "0")}`);
    const r = await importStatement("u1", dataUrl(Buffer.from(linhas.join("\n"), "utf8"), "text/csv"), "extrato.csv");
    expect(r.leitor).toBe("ofx_csv");
    expect(r.importados).toBe(2500);
    expect(modelo.chamado).toBe(0);
    expect(gerado).not.toHaveBeenCalled();
    const cmd = executar.mock.calls[0]![1] as Importar;
    expect(cmd.tipo).toBe("importar");
    expect(cmd.linhas).toHaveLength(2500);
    expect(cmd.linhas[0]).toMatchObject({ data: "2026-09-01", valor: 100, natureza: "despesa", descricao: "Compra 0" });
    expect(cmd.linhas[2499]).toMatchObject({ valor: 250099 });
  });

  it("OFX: as transações saem do <STMTTRN>, e o que já estava lançado não entra de novo", async () => {
    const ofx = [
      "OFXHEADER:100", "DATA:OFXSGML", "", "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001<TRNAMT>-10.00<MEMO>Já lançado</STMTTRN>",
      "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>1500.00<MEMO>Salário</STMTTRN>",
      "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    ].join("\n");
    const r = await importStatement("u1", dataUrl(Buffer.from(ofx), "application/x-ofx"), "extrato.ofx");
    expect(r.leitor).toBe("ofx_csv");
    expect(r.importados).toBe(1);
    expect((executar.mock.calls[0]![1] as Importar).linhas).toEqual([expect.objectContaining({ data: "2026-10-02", valor: 150000, natureza: "receita", descricao: "Salário" })]);
    expect(modelo.chamado).toBe(0);
  });

  it("planilha XLSX do banco também vai pelo motor", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Data", "Histórico", "Valor"], ["05/10/2026", "Mercado", "-89,90"], ["06/10/2026", "Pix recebido", "200,00"]]), "Extrato");
    const xlsx = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
    const r = await importStatement("u1", dataUrl(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "extrato.xlsx");
    expect(r.leitor).toBe("ofx_csv");
    expect(r.importados).toBe(2);
    expect((executar.mock.calls[0]![1] as Importar).linhas.map((l) => l.valor)).toEqual([8990, 20000]);
    expect(modelo.chamado).toBe(0);
  });

  it("CSV sem data nem valor reconhecível: diz por quê, e NÃO cai no modelo para inventar número", async () => {
    await expect(importStatement("u1", dataUrl(Buffer.from("nome;cidade\nAna;Recife\nBia;Natal"), "text/csv"), "x.csv")).rejects.toThrow(/Não encontrei lançamentos/);
    expect(modelo.chamado).toBe(0);
  });

  it("controle: PDF continua indo ao modelo (é o único jeito de ler extrato em PDF)", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const pagina = doc.addPage([600, 300]);
    for (const [i, l] of ["Extrato da conta corrente do Banco Exemplo, periodo de outubro de 2026", "01/10/2026 Padaria Pao Quente -12,50 saldo 987,50", "Agencia 0001 conta 12345-6 titular Fulano de Tal, documento emitido pelo banco"].entries()) pagina.drawText(l, { x: 10, y: 250 - i * 20, size: 9, font: fonte });
    const r = await importStatement("u1", dataUrl(Buffer.from(await doc.save()), "application/pdf"), "extrato.pdf");
    expect(r.leitor).toBe("modelo");
    expect(modelo.chamado).toBe(1);
    expect(r.importados).toBe(1);
  });
});
