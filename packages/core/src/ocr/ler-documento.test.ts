import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * O `lerDocumento` (indexar arquivo, cupom, extrato, os trabalhos do WhatsApp)
 * depois da auditoria de 11/10/2026:
 *   - I7: PDF e imagem também passam pela leitura ISOLADA (thread com teto), e
 *     os avisos do leitor voltam no `DocumentoLido` em vez de sumir;
 *   - M7: o corte de `ocr.maxPages` é avisado;
 *   - M8: HEIC diz claramente que o OCR local não lê o formato;
 *   - I16: fora do e-mail, "tem senha" não manda cadastrar uma senha que não seria usada.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
const sobrescrito: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await import("../settings/defs");
  const valor = (k: string) => (k in sobrescrito ? sobrescrito[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
const ocrImagem = vi.hoisted(() => vi.fn(async () => ({ texto: "CUPOM FISCAL TOTAL R$ 12,34 obrigado pela preferência", confianca: 0.95, fracaoRuim: 0 })));
vi.mock("./tesseract", () => ({ ocrImagem, ocrImage: vi.fn(), encerrarOcr: vi.fn(), confiancaDaPagina: vi.fn() }));
vi.mock("./visao", () => ({ lerComVisao: vi.fn(async () => null), ondeLer: vi.fn() }));
vi.mock("../arquivos/isolado", async (orig) => {
  const real = await orig<typeof import("../arquivos/isolado")>();
  return { ...real, extrairIsolado: vi.fn(real.extrairIsolado) };
});

import { lerDocumento } from "./index";
import { extrairIsolado } from "../arquivos/isolado";
import { ArquivoProtegidoError, DocumentoIlegivelError } from "../arquivos";

const FX = join(__dirname, "../arquivos/__fixtures__");
const fx = (n: string) => readFileSync(join(FX, n));

async function pdfDePaginas(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) doc.addPage([400, 300]).drawText(`Pagina ${i} do contrato de prestacao de servicos, com texto suficiente para a camada nativa do PDF. Clausula ${i}: vigencia de doze meses a contar da assinatura.`, { x: 5, y: 150, size: 6, font: fonte });
  return Buffer.from(await doc.save());
}

beforeEach(() => {
  for (const k of Object.keys(sobrescrito)) delete sobrescrito[k];
  vi.clearAllMocks();
});

describe("PDF e imagem pela leitura isolada (I7)", () => {
  it("PDF passa pelo extrairIsolado e volta com o detalhe por página de sempre", async () => {
    const lido = await lerDocumento(fx("boleto.pdf"), { nome: "boleto.pdf", mime: "application/pdf" });
    expect(extrairIsolado).toHaveBeenCalledTimes(1);
    expect(vi.mocked(extrairIsolado).mock.calls[0]![1]).toMatchObject({ tipo: expect.objectContaining({ familia: "pdf" }) });
    expect(lido.paginas[0]).toMatchObject({ numero: 1, origem: "pdf" });
    expect(lido.textos.join("")).toContain("Enel Distribuicao");
    expect(lido.resumo.nativas).toBe(1);
  });

  it("imagem também, com a origem por OCR", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const lido = await lerDocumento(png, { nome: "cupom.png", mime: "image/png" });
    expect(extrairIsolado).toHaveBeenCalledTimes(1);
    expect(lido.paginas[0]!.origem).toBe("ocr");
    expect(lido.textos[0]).toContain("CUPOM FISCAL");
  });

  it("os avisos do leitor voltam no DocumentoLido (o CSV cortado em linhasMax, por exemplo)", async () => {
    sobrescrito["anexos.linhasMax"] = 2;
    const lido = await lerDocumento(fx("tabela.csv"), { nome: "tabela.csv", mime: "text/csv" });
    expect(lido.avisos?.join(" ")).toMatch(/tem 3 linhas; li as primeiras 2/);
  });
});

describe("o teto de páginas é avisado (M7)", () => {
  it("PDF de 3 páginas com ocr.maxPages = 2: lê 2 e diz que cortou", async () => {
    sobrescrito["ocr.maxPages"] = 2;
    const lido = await lerDocumento(await pdfDePaginas(3), { nome: "contrato.pdf", mime: "application/pdf" });
    expect(lido.paginas).toHaveLength(2);
    expect(lido.avisos?.join(" ")).toMatch(/O PDF tem 3 páginas; li as primeiras 2/);
  });

  it("controle: dentro do teto, sem aviso", async () => {
    const lido = await lerDocumento(await pdfDePaginas(2), { nome: "contrato.pdf", mime: "application/pdf" });
    expect(lido.paginas).toHaveLength(2);
    expect(lido.avisos ?? []).toEqual([]);
  });
});

describe("HEIC (M8)", () => {
  it("o OCR local nem é chamado, e a frase diz o limite e o que fazer", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    const erro = (await lerDocumento(heic, { nome: "foto.heic", mime: "image/heic" }).catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(DocumentoIlegivelError);
    expect(erro.message).toMatch(/HEIC/);
    expect(erro.message).toMatch(/mande a foto como JPG/);
    expect(ocrImagem).not.toHaveBeenCalled();
  });
});

describe("PDF com senha fora do e-mail (I16)", () => {
  it("sem remetente, a frase não manda cadastrar a senha", async () => {
    const erro = (await lerDocumento(fx("fatura-senha.pdf"), { nome: "fatura.pdf", mime: "application/pdf" }).catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(ArquivoProtegidoError);
    expect(erro.message).toMatch(/só é tentada em anexo de e-mail/);
    expect(erro.message).not.toMatch(/Cadastre a senha/);
  });

  it("controle: vindo de um e-mail (o trabalho do usar_anexo traz as senhas do remetente), abre", async () => {
    const lido = await lerDocumento(fx("fatura-senha.pdf"), { nome: "fatura.pdf", mime: "application/pdf", senhas: ["errada", "12345"], semRemetente: false });
    expect(lido.textos.join("")).toContain("Total da fatura: R$ 1.234,56");
    expect(lido.abertoComSenha).toBe(true);
    expect(lido.senhaUsada).toBe(1);
  });
});
