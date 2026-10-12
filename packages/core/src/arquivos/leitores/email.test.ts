import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O leitor de e-mail anexado (EML, MSG) e de página arquivada (MHT), com teste
 * próprio (C3). O que a auditoria de 11/10/2026 pegou (I6): os anexos do EML
 * não gastavam do teto de arquivos (2.000 imagens = 2.000 OCR e visão), e o
 * MSG dentro do MSG não tinha fundo.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
const sobrescrito: Record<string, unknown> = {};
vi.mock("../../settings", async () => {
  const { SETTING_DEFS } = await import("../../settings/defs");
  const valor = (k: string) => (k in sobrescrito ? sobrescrito[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});

// o Tesseract real baixaria o idioma: o anexo de imagem do fixture é "lido" por um duplo
vi.mock("../../ocr/tesseract", () => ({ ocrImagem: vi.fn(async () => ({ texto: "texto da imagem anexada ao e-mail", confianca: 0.95, fracaoRuim: 0 })), ocrImage: vi.fn(), encerrarOcr: vi.fn(), confiancaDaPagina: vi.fn() }));
vi.mock("../../ocr/visao", () => ({ lerComVisao: vi.fn(async () => null), ondeLer: vi.fn() }));

import { extrair } from "../extrair";
import { lerDadosDoMsg, lerEml, lerMht, tituloDoHtml, type MsgDados, type MsgReader } from "./email";
import type { Extraido } from "../tipos";

const FX = join(__dirname, "../__fixtures__");

beforeEach(() => {
  for (const k of Object.keys(sobrescrito)) delete sobrescrito[k];
});

/** Um EML com `n` anexos de texto, montado à mão (MIME de verdade, base64). */
function emlComAnexos(n: number): Buffer {
  const partes = Array.from({ length: n }, (_, i) =>
    ["--LIMITE", "Content-Type: text/plain; charset=utf-8", `Content-Disposition: attachment; filename="nota${i}.txt"`, "Content-Transfer-Encoding: base64", "", Buffer.from(`conteúdo da nota ${i}`).toString("base64")].join("\r\n"),
  );
  return Buffer.from(
    ["From: Fulana <f@x.com>", "To: eu@x.com", "Subject: Muitos anexos", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="LIMITE"', "", "--LIMITE", "Content-Type: text/plain; charset=utf-8", "", "Segue tudo.", ...partes, "--LIMITE--", ""].join("\r\n"),
  );
}

describe("EML: cabeçalho, corpo e anexos pelo mesmo extrator", () => {
  it("o fixture encaminhado: corpo e anexo lidos", async () => {
    const r = await extrair(readFileSync(join(FX, "encaminhado.eml")), { nome: "encaminhado.eml" });
    expect(r.lido).toBe(true);
    expect(r.tipo.familia).toBe("email");
    expect(r.estruturado).toMatchObject({ tipo: "email" });
  });

  it("cada anexo do e-mail anexado gasta do teto de arquivos: passou, os que sobram são listados, não abertos (I6)", async () => {
    sobrescrito["anexos.zipMaxArquivos"] = 3;
    const r = await extrair(emlComAnexos(6), { nome: "muitos.eml" });
    expect(r.lido).toBe(true);
    expect(r.texto).toContain("Segue tudo.");
    const lidos = r.arquivos!.filter((a) => a.lido);
    const fora = r.arquivos!.filter((a) => /passa do teto de 3 arquivos/.test(a.resumo));
    expect(lidos).toHaveLength(3);
    expect(fora).toHaveLength(3);
  });

  it("controle: dentro do teto, todos os anexos são lidos", async () => {
    const r = await extrair(emlComAnexos(3), { nome: "poucos.eml" });
    expect(r.arquivos!.every((a) => a.lido)).toBe(true);
    expect(r.texto).toContain("conteúdo da nota 2");
  });

  it("lerEml chama o extrator uma vez por anexo, com o nome e o tipo declarado", async () => {
    const vistos: string[] = [];
    const filho = async (_b: Buffer, nome: string, mime: string | null): Promise<Extraido> => {
      vistos.push(`${nome}:${mime}`);
      return { nome, tipo: { ext: "txt", mime: "text/plain", familia: "texto" }, tamanho: 1, sha256: "", lido: true, texto: "x", partes: ["x"], resumo: "Texto.", tabelas: 0, avisos: [] };
    };
    const e = await lerEml(emlComAnexos(2), filho);
    expect(vistos).toEqual(["nota0.txt:text/plain", "nota1.txt:text/plain"]);
    expect(e.cabecalho.assunto).toBe("Muitos anexos");
  });
});

describe("MSG dentro de MSG tem fundo (I6)", () => {
  /** `niveis` e-mails um dentro do outro, como o msgreader os entrega (campos já lidos). */
  function aninhado(niveis: number): MsgDados {
    let atual: MsgDados = { subject: `nível ${niveis}`, body: "o mais fundo" };
    for (let i = niveis - 1; i >= 0; i--) atual = { subject: `nível ${i}`, body: `corpo ${i}`, attachments: [{ innerMsgContent: true, innerMsgContentFields: atual, name: `dentro-${i + 1}.msg` }] };
    return atual;
  }
  const leitor = {} as MsgReader;
  const semFilho = async (): Promise<Extraido> => {
    throw new Error("não devia ser chamado");
  };

  it("10 níveis com teto de 3: o quarto vira 'além de 3 nível(is)', e a recursão para", async () => {
    const e = await lerDadosDoMsg(semFilho, { niveis: 3 })(aninhado(10), leitor, 0);
    // o texto do aninhado mostra até onde foi aberto: níveis 1, 2 e 3, e o 4º só citado
    const texto = e.anexos[0]!.texto;
    expect(texto).toContain("corpo 1");
    expect(texto).toContain("corpo 3");
    expect(texto).not.toContain("corpo 4");
    expect(texto).toContain("além de 3 nível(is)");
    expect(texto).not.toContain("o mais fundo");
  });

  it("o e-mail de dentro também gasta do teto de arquivos", async () => {
    let restantes = 1;
    const e = await lerDadosDoMsg(semFilho, { niveis: 10, podeAbrir: () => (restantes-- > 0) })(aninhado(3), leitor, 0);
    expect(e.anexos[0]!.texto).toContain("passa do teto de arquivos");
  });

  it("controle: sem teto, abre todos os níveis", async () => {
    const e = await lerDadosDoMsg(semFilho, {})(aninhado(4), leitor, 0);
    expect(e.anexos[0]!.texto).toContain("o mais fundo");
  });
});

describe("MHT e título", () => {
  it("o MHT do fixture vira texto, sem recurso remoto", async () => {
    const m = await lerMht(readFileSync(join(FX, "contrato.mht")));
    expect(m.texto.length).toBeGreaterThan(10);
  });

  it("título por indexOf, sem regex que recomeça", () => {
    expect(tituloDoHtml("<html><title> Contrato </title></html>")).toBe("Contrato");
    expect(tituloDoHtml("<title>sem fim")).toBeNull();
  });
});
