import { beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";

/**
 * O leitor de compactado (ZIP em memória, 7Z/RAR/AES pelo 7-Zip) com teste
 * próprio, como pede a C3: os casos da auditoria de 11/10/2026 que o
 * `extrair.test.ts` não cobria. O 7-Zip NÃO está instalado nesta máquina: o
 * executor é simulado (`SeteZip`), falando como o `7z` real fala.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
const sobrescrito: Record<string, unknown> = {};
vi.mock("../../settings", async () => {
  const { SETTING_DEFS } = await import("../../settings/defs");
  const valor = (k: string) => (k in sobrescrito ? sobrescrito[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});

import { extrair } from "../extrair";
import { ehAlvoDeLeitura } from "../zip";
import type { SeteZip } from "./compactado";
import { montarZip, montarZipComSenha } from "../__fixtures__/montar-zip";

beforeEach(() => {
  for (const k of Object.keys(sobrescrito)) delete sobrescrito[k];
});

const SETE_Z = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), Buffer.alloc(64)]);
const senhaDe = (args: string[]) => args.find((a) => a.startsWith("-p"))!.slice(2);

/**
 * Um 7Z com o CONTEÚDO cifrado e o cabeçalho aberto (o caso comum: 7Z sem
 * `-mhe`, ZIP AES): `7z l` lista com qualquer senha; só a extração confere.
 */
function seteZipConteudoCifrado(certa: string, arquivos: Record<string, string>, chamadas: string[][] = []): SeteZip {
  return {
    rodar: async (args) => {
      chamadas.push(args);
      if (args[0] === "l") {
        const blocos = Object.entries(arquivos).map(([n, c]) => `Path = ${n}\nSize = ${c.length}\nFolder = -\nEncrypted = +`);
        return { codigo: 0, saida: Buffer.from(blocos.join("\n\n")), erro: "" };
      }
      const alvo = args[args.length - 1]!;
      if (senhaDe(args) !== certa) return { codigo: 2, saida: Buffer.alloc(0), erro: `ERROR: Wrong password : ${alvo}` };
      return { codigo: 0, saida: Buffer.from(arquivos[alvo] ?? ""), erro: "" };
    },
  };
}

describe("7-Zip com o conteúdo cifrado (I4)", () => {
  it("a segunda senha cadastrada, a certa, é tentada na extração e guardada para os outros arquivos", async () => {
    const chamadas: string[][] = [];
    const sete = seteZipConteudoCifrado("certa", { "a.txt": "Primeiro arquivo do cofre.", "b.txt": "Segundo arquivo do cofre." }, chamadas);
    const r = await extrair(SETE_Z, { nome: "cofre.7z", senhas: ["errada", "certa"], seteZip: sete });
    expect(r.lido).toBe(true);
    expect(r.protegido).toBeUndefined();
    expect(r.texto).toContain("Primeiro arquivo do cofre.");
    expect(r.texto).toContain("Segundo arquivo do cofre.");
    expect(r.senhaUsada).toBe(1);
    // a certa, uma vez achada, vale para o segundo arquivo sem tentar a errada de novo
    const extracoes = chamadas.filter((a) => a[0] === "e").map((a) => `${a[a.length - 1]}:${senhaDe(a)}`);
    expect(extracoes).toEqual(["a.txt:errada", "a.txt:certa", "b.txt:certa"]);
    expect(JSON.stringify(r)).not.toContain("certa\"");
  });

  it("nenhuma senha abre: sai PROTEGIDO, e não lido (senão o cache diria 'tem senha' depois de cadastrada)", async () => {
    const sete = seteZipConteudoCifrado("a-de-verdade", { "a.txt": "x", "b.txt": "y" });
    const r = await extrair(SETE_Z, { nome: "cofre.7z", senhas: ["errada", "outra"], seteZip: sete });
    expect(r.lido).toBe(false);
    expect(r.protegido?.motivo).toMatch(/nenhuma das senhas cadastradas/);
    expect(r.senhaUsada).toBeUndefined();
  });

  it("sem senha cadastrada, diz para cadastrar; fora do e-mail, diz que a senha não seria usada (I16)", async () => {
    const sete = seteZipConteudoCifrado("x", { "a.txt": "y" });
    expect((await extrair(SETE_Z, { nome: "c.7z", seteZip: sete })).protegido?.motivo).toMatch(/Cadastre a senha do remetente/);
    const doZap = await extrair(SETE_Z, { nome: "c.7z", seteZip: sete, semRemetente: true });
    expect(doZap.protegido?.motivo).toMatch(/só é tentada em anexo de e-mail/);
    expect(doZap.protegido?.motivo).not.toMatch(/Cadastre/);
  });

  it("controle: compactado sem senha nenhuma continua lido como sempre", async () => {
    const sete: SeteZip = {
      rodar: async (args) => (args[0] === "l" ? { codigo: 0, saida: Buffer.from("Path = nota.txt\nSize = 9\nFolder = -\nEncrypted = -"), erro: "" } : { codigo: 0, saida: Buffer.from("nota solta"), erro: "" }),
    };
    const r = await extrair(SETE_Z, { nome: "p.7z", seteZip: sete });
    expect(r.lido).toBe(true);
    expect(r.texto).toContain("nota solta");
    expect(r.senhaUsada).toBeUndefined();
  });
});

describe("ZIP feito no Mac não é bomba (M4)", () => {
  it("150 arquivos + 150 `._` + pastas + `.DS_Store` passam no teto de 200 arquivos", async () => {
    const arquivos: Record<string, string> = { "docs/": "", "__MACOSX/": "", "__MACOSX/docs/": "" };
    for (let i = 0; i < 150; i++) {
      arquivos[`docs/nota${i}.txt`] = `nota ${i}`;
      arquivos[`__MACOSX/docs/._nota${i}.txt`] = "lixo do Finder";
    }
    arquivos["docs/.DS_Store"] = "lixo";
    const r = await extrair(montarZip(arquivos), { nome: "mac.zip" });
    expect(r.lido).toBe(true);
    expect(r.resumo).toMatch(/150 arquivo/);
    expect(r.texto).not.toContain("lixo do Finder");
  });

  it("controle: 201 arquivos de verdade continuam recusados", async () => {
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 201; i++) arquivos[`n${i}.txt`] = "x";
    const r = await extrair(montarZip(arquivos), { nome: "muitos.zip" });
    expect(r.lido).toBe(false);
    expect(r.resumo).toMatch(/mais de 200 arquivos/);
  });

  it("o que conta como arquivo", () => {
    expect(ehAlvoDeLeitura("docs/nota.txt")).toBe(true);
    expect(ehAlvoDeLeitura("docs/")).toBe(false);
    expect(ehAlvoDeLeitura("__MACOSX/docs/._nota.txt")).toBe(false);
    expect(ehAlvoDeLeitura("docs/._nota.txt")).toBe(false);
    expect(ehAlvoDeLeitura("Thumbs.db")).toBe(false);
  });
});

describe("teto de TEXTO extraído (I5)", () => {
  it("ZIP de dezenas de KB com TXT que comprime 1000x: o texto para no teto, com aviso, e o resto nem é aberto", async () => {
    sobrescrito["anexos.textoMaxCaracteres"] = 1_000_000;
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 10; i++) arquivos[`parte${i}.txt`] = "a".repeat(2 * 1024 * 1024);
    const zip = montarZip(arquivos);
    // 20 MB de texto em menos de 40 KB (mil vezes): a bomba de texto que o orçamento de bytes deixava passar
    expect(zip.length).toBeLessThan(40 * 1024);
    const r = await extrair(zip, { nome: "texto.zip" });
    expect(r.lido).toBe(true);
    expect(r.texto.length).toBeLessThanOrEqual(1_000_000);
    expect(r.avisos.join(" ")).toMatch(/teto de 1\.000\.000 caracteres/);
    expect(r.arquivos?.filter((a) => /chegou ao teto/.test(a.resumo)).length).toBeGreaterThan(0);
  });

  it("controle: abaixo do teto, o texto vem inteiro e sem aviso", async () => {
    const r = await extrair(montarZip({ "a.txt": "contrato curto" }), { nome: "a.zip" });
    expect(r.texto).toContain("contrato curto");
    expect(r.avisos.join(" ")).not.toMatch(/teto/);
  });
});

describe("a config é lida uma vez por leitura, não uma por arquivo de dentro (M6)", () => {
  it("ZIP com 30 arquivos: os tetos saem da config uma vez só", async () => {
    const { settings } = await import("../../settings");
    const getMany = vi.spyOn(settings, "getMany");
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 30; i++) arquivos[`n${i}.txt`] = `nota ${i}`;
    await extrair(montarZip(arquivos), { nome: "z.zip" });
    const dosTetos = getMany.mock.calls.filter(([ks]) => (ks as string[]).includes("anexos.zipMaxArquivos"));
    expect(dosTetos).toHaveLength(1);
    getMany.mockRestore();
  });
});

describe("contas do orçamento (M5)", () => {
  it("o arquivo de dentro do GZIP conta no teto de arquivos", async () => {
    sobrescrito["anexos.zipMaxArquivos"] = 4;
    const gz = gzipSync(Buffer.from("conteúdo comprimido"));
    const zip = montarZip({ "a.txt.gz": gz, "b.txt.gz": gz, "c.txt.gz": gz });
    // 3 entradas do ZIP + 3 de dentro dos GZIP = 6, acima de 4: antes o GZIP não contava, e passava
    const r = await extrair(zip, { nome: "g.zip" });
    expect(r.lido).toBe(false);
    expect(r.resumo).toMatch(/passam de 4 arquivos/);
    sobrescrito["anexos.zipMaxArquivos"] = 6;
    expect((await extrair(zip, { nome: "g.zip" })).lido).toBe(true);
  });

  it("um arquivo cifrado que mente o tamanho e passa do teto de ARQUIVO fica de fora sozinho, sem recusar o ZIP", async () => {
    sobrescrito["anexos.tamanhoMaxMb"] = 1;
    const zip = montarZipComSenha("grande.txt", Buffer.alloc(3 * 1024 * 1024, 0x61), "orbita123", 100);
    const r = await extrair(zip, { nome: "z.zip", senhas: ["orbita123"] });
    expect(r.resumo).not.toMatch(/^Recusado/);
    expect(r.lido).toBe(true);
    expect(r.arquivos?.[0]?.resumo).toMatch(/grande demais para ler/);
  });

  it("controle: o mesmo arquivo cifrado, dentro do teto, abre com a senha e diz qual abriu", async () => {
    const zip = montarZipComSenha("nota.txt", Buffer.from("O cofre fica na sala."), "orbita123");
    const r = await extrair(zip, { nome: "z.zip", senhas: ["outra", "orbita123"] });
    expect(r.texto).toContain("O cofre fica na sala.");
    expect(r.senhaUsada).toBe(1);
  });
});
