import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@orbita/db", () => ({ db: {} }));

// a config de verdade (os defaults de defs.ts), com o que o teste sobrescrever
const sobrescrito: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await import("../settings/defs");
  const valor = (k: string) => (k in sobrescrito ? sobrescrito[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});

// OCR e visão de imagem: o Tesseract real baixaria o idioma; aqui ele "lê" um cupom
const { ocrImagem, spawn, writeFile } = vi.hoisted(() => ({
  ocrImagem: vi.fn(async () => ({ texto: "CUPOM FISCAL TOTAL R$ 12,34 obrigado pela preferência", confianca: 0.95, fracaoRuim: 0 })),
  spawn: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("../ocr/tesseract", () => ({ ocrImagem, ocrImage: vi.fn(), encerrarOcr: vi.fn(), confiancaDaPagina: vi.fn() }));
vi.mock("../ocr/visao", () => ({ lerComVisao: vi.fn(async () => null), ondeLer: vi.fn() }));
vi.mock("../voice/service-url", () => ({ voiceServiceUrl: () => "http://voz.local" }));

// "nunca executa, nunca grava": o extrator não pode chamar processo nem gravar arquivo para ler um executável
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn: (...a: unknown[]) => spawn(...a) }));
vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return { ...real, writeFile: (...a: Parameters<typeof real.writeFile>) => { writeFile(...a); return real.writeFile(...a); } };
});

import { extrair } from "./extrair";
import { detectarTipo } from "./detectar";
import { listagemDo7z, type SeteZip } from "./leitores/compactado";
import { rtfParaTexto } from "./leitores/office";
import { lerDocumento } from "../ocr/index";
import { ArquivoProtegidoError, DocumentoIlegivelError } from "../arquivos";

const FX = join(__dirname, "__fixtures__");
const fx = (n: string) => readFileSync(join(FX, n));
const midia = {
  transcrever: vi.fn(async (_a: Uint8Array, _m: string) => ({ texto: "oi Wesley, o orçamento ficou em dois mil reais", provedor: "teste" })),
  descreverQuadro: vi.fn(async () => "uma sala de reunião"),
};

beforeEach(() => {
  for (const k of Object.keys(sobrescrito)) delete sobrescrito[k];
  spawn.mockClear();
  writeFile.mockClear();
  midia.transcrever.mockClear();
});

describe("detecção pelos bytes, nunca pelo nome", () => {
  it("um .docx renomeado para .pdf é lido como Word, com aviso", async () => {
    const r = await extrair(fx("contrato.docx"), { nome: "fatura.pdf", mimeDeclarado: "application/pdf" });
    expect(r.tipo.ext).toBe("docx");
    expect(r.lido).toBe(true);
    expect(r.texto).toContain("Contrato de prestação de serviços");
    expect(r.avisos.join(" ")).toMatch(/dizia \.pdf/);
  });

  it("o lerDocumento (indexar, WhatsApp, cupom) também decide pelos bytes", async () => {
    const lido = await lerDocumento(fx("contrato.docx"), { nome: "fatura.pdf", mime: "application/pdf" });
    expect(lido.textos.join("")).toContain("Vigência de doze meses");
    await expect(lerDocumento(fx("instalador.exe"), { nome: "fatura.pdf", mime: "application/pdf" })).rejects.toBeInstanceOf(DocumentoIlegivelError);
  });

  it("assinaturas de imagem, áudio, vídeo, compactado e contêiner OLE", async () => {
    const cab = (bytes: number[], resto = 64) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(resto)]);
    expect((await detectarTipo(cab([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).familia).toBe("imagem"); // GIF
    expect((await detectarTipo(cab([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]))).familia).toBe("imagem"); // TIFF
    expect((await detectarTipo(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(40)]))).ext).toBe("webp");
    expect((await detectarTipo(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40)]))).familia).toBe("imagem");
    expect((await detectarTipo(cab([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]))).ext).toBe("7z");
    expect((await detectarTipo(cab([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).ext).toBe("rar");
    expect((await detectarTipo(fx("recado.wav"))).familia).toBe("audio");
    expect((await detectarTipo(fx("video.mp4"))).familia).toBe("video");
    expect((await detectarTipo(fx("contrato.doc"))).ext).toBe("doc");
    expect((await detectarTipo(fx("planilha.xls"))).ext).toBe("xls");
    expect((await detectarTipo(fx("mensagem.msg"))).ext).toBe("msg");
    expect((await detectarTipo(fx("pacote.msi"))).familia).toBe("executavel");
    expect((await detectarTipo(fx("contrato-senha.docx"))).familia).toBe("protegido");
    expect((await detectarTipo(fx("app.apk"))).familia).toBe("executavel");
  });
});

describe("uma linha da tabela do C3 por vez", () => {
  it("PDF com texto: o leitor de sempre", async () => {
    const r = await extrair(fx("boleto.pdf"), { nome: "boleto.pdf" });
    expect(r.tipo.familia).toBe("pdf");
    expect(r.texto).toContain("Enel Distribuicao");
    expect(r.texto).toContain("16050000018743");
    expect(r.resumo).toMatch(/PDF de 1 página/);
  });

  it("imagem: OCR (e visão quando o OCR lê mal)", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const r = await extrair(png, { nome: "cupom.png" });
    expect(r.tipo.familia).toBe("imagem");
    expect(r.texto).toContain("CUPOM FISCAL");
  });

  it("texto em Windows-1252 e UTF-16 sai certo, e CSV/TSV viram tabela", async () => {
    const csv = await extrair(fx("tabela.csv"), { nome: "tabela.csv" });
    expect(csv.tipo.familia).toBe("tabela");
    expect(csv.texto).toContain("| João | 10,50 | São Paulo |");
    expect(csv.resumo).toContain("windows-1252");
    const tsv = await extrair(fx("tabela.tsv"), { nome: "tabela.tsv" });
    expect(tsv.texto).toContain("| Café | 2 |");
    const u16 = await extrair(fx("texto-utf16.txt"), { nome: "texto.txt" });
    expect(u16.texto).toContain("Relatório anual em UTF-16: ação e atenção.");
    expect((await extrair(fx("dados.json"), { nome: "dados.json" })).texto).toContain('"cliente": "Fulana"');
    expect((await extrair(fx("notas.md"), { nome: "notas.md" })).texto).toContain("- pagar a luz");
  });

  it("CSV maior que o teto de linhas avisa e para no teto", async () => {
    sobrescrito["anexos.linhasMax"] = 2;
    const r = await extrair(fx("tabela.csv"), { nome: "tabela.csv" });
    expect(r.texto).not.toContain("Brasília");
    expect(r.avisos.join(" ")).toMatch(/tem 3 linhas; li as primeiras 2/);
  });

  it("HTML sem script, sem estilo e sem imagem remota; tabela em Markdown", async () => {
    const r = await extrair(fx("pagina.html"), { nome: "pagina.html" });
    expect(r.texto).toContain("Sua conta vence amanhã.");
    expect(r.texto).toContain("| Luz | R$ 90 |");
    expect(r.texto).not.toMatch(/alert|color:red|rastreador/);
  });

  it("MHT (página arquivada) é lida pelo HTML de dentro", async () => {
    const r = await extrair(fx("contrato.mht"), { nome: "contrato.mht" });
    expect(r.tipo.ext).toBe("mht");
    expect(r.texto).toContain("Contrato de prestação de serviços");
  });

  it("Word (DOCX, DOCM), ODT e RTF: texto e tabela; macro nunca roda", async () => {
    const docx = await extrair(fx("contrato.docx"), { nome: "contrato.docx" });
    expect(docx.texto).toContain("| Manutenção | R$ 300 |");
    expect(docx.tabelas).toBe(1);
    const docm = await extrair(fx("contrato.docm"), { nome: "contrato.docm" });
    expect(docm.lido).toBe(true);
    expect(docm.avisos.join(" ")).toMatch(/macros/);
    const odt = await extrair(fx("contrato.odt"), { nome: "contrato.odt" });
    expect(odt.texto).toContain("Vigência de doze meses");
    expect(odt.texto).toContain("| Manutenção | R$ 300 |");
    const rtf = await extrair(fx("contrato.rtf"), { nome: "contrato.rtf" });
    expect(rtf.texto).toContain("Contrato de prestação de serviços");
    expect(rtf.texto).toContain("R$ 1.250,00");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("RTF: escape hexadecimal, Unicode e destino ignorado", () => {
    expect(rtfParaTexto("{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\*\\generator Word;}Ol\\'e1, \\u8364? 10\\par fim}")).toBe("Olá, € 10\nfim");
  });

  it("Word antigo (DOC binário)", async () => {
    const r = await extrair(fx("contrato.doc"), { nome: "contrato.doc" });
    expect(r.texto).toContain("Contrato de prestação de serviços");
    expect(r.texto).toContain("Manutenção");
  });

  it("planilhas XLSX, XLSM, XLS e ODS: cada aba vira tabela com o nome", async () => {
    for (const n of ["planilha.xlsx", "planilha.xlsm", "planilha.xls", "planilha.ods"]) {
      const r = await extrair(fx(n), { nome: n });
      expect(r.tipo.familia, n).toBe("planilha");
      expect(r.texto, n).toContain("## Aba: Vendas");
      expect(r.texto, n).toContain("| Fevereiro | 2300 |");
      expect(r.texto, n).toContain("## Aba: Custos");
      expect(r.partes, n).toHaveLength(2);
    }
    expect((await extrair(fx("planilha.xlsm"), { nome: "p.xlsm" })).avisos.join(" ")).toMatch(/macros/);
  });

  it("apresentação PPTX e ODP: texto de cada slide e das notas, na ordem", async () => {
    const pptx = await extrair(fx("apresentacao.pptx"), { nome: "a.pptx" });
    expect(pptx.partes).toHaveLength(2);
    expect(pptx.partes[0]).toContain("Plano de lançamento");
    expect(pptx.partes[0]).toContain("Notas: Lembrar de citar o orçamento");
    expect(pptx.partes[1]).toContain("Próximos passos");
    const odp = await extrair(fx("apresentacao.odp"), { nome: "a.odp" });
    expect(odp.texto).toContain("Meta: 500 clientes no trimestre");
    expect(odp.texto.indexOf("Plano de lançamento")).toBeLessThan(odp.texto.indexOf("Próximos passos"));
  });

  it("e-mail anexado (EML): cabeçalho, corpo, anexos lidos e link do Drive listado", async () => {
    const r = await extrair(fx("encaminhado.eml"), { nome: "encaminhado.eml" });
    expect(r.tipo.familia).toBe("email");
    expect(r.texto).toContain("Assunto: Contrato revisado e orçamento");
    expect(r.texto).toContain("Olá, segue o contrato revisado.");
    expect(r.texto).toContain("https://drive.google.com/file/d/abc123/view");
    // o DOCX de dentro passou pelo mesmo extrator
    expect(r.texto).toContain("| Manutenção | R$ 300 |");
    expect(r.arquivos?.map((a) => a.caminho)).toEqual(["logo.png", "contrato.docx"]);
  });

  it("e-mail do Outlook (MSG) com o anexo dele", async () => {
    const r = await extrair(fx("mensagem.msg"), { nome: "mensagem.msg" });
    expect(r.texto).toContain("Assunto: Fatura de outubro");
    expect(r.texto).toContain("R$ 89,90");
    expect(r.texto).toContain("protocolo 4455");
  });

  it("ZIP: lista e lê cada arquivo pelo mesmo extrator, inclusive o ZIP de dentro; o .exe nunca é aberto", async () => {
    const r = await extrair(fx("arquivos.zip"), { nome: "arquivos.zip" });
    expect(r.lido).toBe(true);
    expect(r.texto).toContain("Vigência de doze meses");
    expect(r.texto).toContain("Lembrete: renovar o seguro.");
    expect(r.texto).toContain("Texto do zip de dentro.");
    const exe = r.arquivos?.find((a) => a.caminho === "programa.exe");
    expect(exe?.lido).toBe(false);
    expect(exe?.familia).toBe("executavel");
    expect(spawn).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("ZIP dentro de ZIP para no nível configurado", async () => {
    sobrescrito["anexos.zipProfundidade"] = 3;
    expect((await extrair(fx("profundo.zip"), { nome: "p.zip" })).texto).not.toContain("chegou ao fundo");
    sobrescrito["anexos.zipProfundidade"] = 4;
    expect((await extrair(fx("profundo.zip"), { nome: "p.zip" })).texto).toContain("chegou ao fundo");
  });

  it("ZIP bomba é recusado nos tetos, sem descompactar tudo", async () => {
    sobrescrito["anexos.zipMaxMb"] = 10;
    const bomba = await extrair(fx("bomba.zip"), { nome: "bomba.zip" });
    expect(bomba.lido).toBe(false);
    expect(bomba.resumo).toMatch(/^Recusado/);
    // declara 1 KB e entrega 8 MB: o real é contado, o declarado não vale
    sobrescrito["anexos.zipMaxMb"] = 500;
    const mentirosa = await extrair(fx("bomba-mentirosa.zip"), { nome: "b.zip" });
    expect(mentirosa.lido).toBe(false);
    expect(mentirosa.resumo).toMatch(/bomba/);
    const muitos = await extrair(fx("muitos.zip"), { nome: "m.zip" });
    expect(muitos.resumo).toMatch(/mais de 200 arquivos/);
  });

  it("áudio vira texto pela transcrição; desligada, só o tamanho", async () => {
    const r = await extrair(fx("recado.wav"), { nome: "recado.wav", userId: "u1", midia });
    expect(r.texto).toContain("orçamento ficou em dois mil reais");
    sobrescrito["anexos.transcreverAudio"] = false;
    const off = await extrair(fx("recado.wav"), { nome: "recado.wav", userId: "u1", midia });
    expect(off.lido).toBe(false);
    expect(off.resumo).toMatch(/desligada/);
  });

  it("vídeo: o áudio separado pelo serviço de voz e transcrito, mais quadros se pedido", async () => {
    sobrescrito["anexos.quadrosDoVideo"] = 1;
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      chamadas.push(String(url));
      if (String(url).includes("/extrair/audio")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return Response.json({ quadros: ["data:image/jpeg;base64,AAAA"] });
    }));
    try {
      const r = await extrair(fx("video.mp4"), { nome: "video.mp4", userId: "u1", midia });
      expect(chamadas).toEqual(["http://voz.local/extrair/audio", "http://voz.local/extrair/quadros?quantos=1"]);
      expect(midia.transcrever.mock.calls[0]![1]).toBe("audio/ogg");
      expect(r.texto).toContain("Fala transcrita");
      expect(r.texto).toContain("Quadro 1: uma sala de reunião");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("agenda (ICS) e contato (VCF) viram dado estruturado", async () => {
    const ics = await extrair(fx("convite.ics"), { nome: "convite.ics" });
    expect(ics.estruturado).toMatchObject({ tipo: "agenda", eventos: [{ titulo: "Reunião de alinhamento", inicio: "2026-10-15T14:00:00Z", local: "Sala 3", organizador: "Fulana", participantes: ["Wesley"] }] });
    expect(ics.texto).toContain("orçamento, contratações e próximos passos");
    const vcf = await extrair(fx("contato.vcf"), { nome: "contato.vcf" });
    expect(vcf.estruturado).toMatchObject({ tipo: "contato", contatos: [{ nome: "Maria Souza", telefones: ["+55 11 99999-8888"], emails: ["maria@exemplo.com"], aniversario: "1990-04-12" }] });
  });

  it("XML de NF-e: emitente, itens, valor e data", async () => {
    const r = await extrair(fx("nota.xml"), { nome: "nota.xml" });
    expect(r.tipo.familia).toBe("nota_fiscal");
    expect(r.estruturado).toMatchObject({ tipo: "nota_fiscal", nota: { emitente: "Mercado Bom Preço Ltda", cnpj: "12345678000195", data: "2026-10-05", valorTotal: 63.7, numero: "1234" } });
    expect(r.texto).toContain("Café 500g");
  });

  it("executável e instalador: só tipo, tamanho e hash, nunca aberto nem gravado", async () => {
    for (const n of ["instalador.exe", "pacote.msi", "app.apk"]) {
      const r = await extrair(fx(n), { nome: n });
      expect(r.lido, n).toBe(false);
      expect(r.texto, n).toBe("");
      expect(r.resumo, n).toContain(r.sha256);
    }
    const lnk = Buffer.concat([Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]), Buffer.alloc(60)]);
    expect((await extrair(lnk, { nome: "atalho.lnk" })).tipo.familia).toBe("executavel");
    const iso = Buffer.alloc(32774 + 10);
    iso.write("CD001", 32769, "latin1");
    expect((await extrair(iso, { nome: "disco.iso" })).tipo.familia).toBe("executavel");
    expect(spawn).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("script é dado: lido como texto, com aviso, nunca executado", async () => {
    const r = await extrair(fx("script.ps1"), { nome: "script.ps1" });
    expect(r.tipo.familia).toBe("script");
    expect(r.texto).toContain("Remove-Item");
    expect(r.avisos.join(" ")).toMatch(/nada foi executado/);
    expect((await extrair(fx("instalar.bat"), { nome: "instalar.bat" })).tipo.familia).toBe("script");
  });

  it("protegido por senha: diz que está protegido; com a senha cadastrada, lê", async () => {
    const pdf = await extrair(fx("fatura-senha.pdf"), { nome: "fatura.pdf" });
    expect(pdf.protegido).toBeTruthy();
    expect(pdf.resumo).toMatch(/tem senha/);
    const aberto = await extrair(fx("fatura-senha.pdf"), { nome: "fatura.pdf", senhas: ["errada", "12345"] });
    expect(aberto.texto).toContain("Total da fatura: R$ 1.234,56");
    // a senha nunca volta no que é lido
    expect(JSON.stringify(aberto)).not.toContain("12345\"");

    expect((await extrair(fx("contrato-senha.docx"), { nome: "c.docx" })).protegido).toBeTruthy();
    expect((await extrair(fx("contrato-senha.docx"), { nome: "c.docx", senhas: ["orbita123"] })).texto).toContain("Vigência de doze meses");
    expect((await extrair(fx("planilha-senha.xlsx"), { nome: "p.xlsx", senhas: ["outra"] })).protegido).toBeTruthy();
    expect((await extrair(fx("planilha-senha.xlsx"), { nome: "p.xlsx", senhas: ["orbita123"] })).texto).toContain("| Janeiro | 1500.5 |");

    expect((await extrair(fx("senha.zip"), { nome: "s.zip" })).protegido).toBeTruthy();
    expect((await extrair(fx("senha.zip"), { nome: "s.zip", senhas: ["orbita123"] })).texto).toContain("O cofre fica na sala.");
    // AES sem 7-Zip: lista, diz o motivo, não abre
    const aes = await extrair(fx("aes.zip"), { nome: "a.zip", senhas: ["orbita123"], seteZip: null });
    expect(aes.protegido?.motivo).toMatch(/AES.*7-Zip/);
  });

  it("o lerDocumento diz 'tem senha' com a exceção certa (a fila não retenta)", async () => {
    await expect(lerDocumento(fx("fatura-senha.pdf"), { nome: "f.pdf", mime: "application/pdf" })).rejects.toBeInstanceOf(ArquivoProtegidoError);
  });

  it("tipo desconhecido: tipo, tamanho e 'não sei ler', nunca os bytes", async () => {
    const lixo = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256));
    const r = await extrair(lixo, { nome: "x.dat" });
    expect(r.lido).toBe(false);
    expect(r.texto).toBe("");
    expect(r.resumo).toMatch(/não sei ler este formato/);
  });
});

describe("7-Zip (7Z, RAR, ZIP com AES)", () => {
  it("lê a listagem do `7z l -slt`", () => {
    const saida = "Path = /tmp/a.7z\nType = 7z\n\n----------\nPath = docs\nFolder = +\nSize = 0\n\nPath = docs\\nota.txt\nFolder = -\nSize = 12\nEncrypted = -\n";
    expect(listagemDo7z(saida)).toEqual([
      { caminho: "docs", tamanho: 0, pasta: true, criptografado: false },
      { caminho: "docs/nota.txt", tamanho: 12, pasta: false, criptografado: false },
    ]);
  });

  it("extrai cada arquivo pela saída padrão e lê pelo mesmo extrator; sem 7-Zip, explica", async () => {
    const chamadas: string[][] = [];
    const sete: SeteZip = {
      rodar: async (args) => {
        chamadas.push(args);
        if (args[0] === "l") return { codigo: 0, saida: Buffer.from("Path = nota.txt\nSize = 21\nFolder = -\n"), erro: "" };
        return { codigo: 0, saida: Buffer.from("Conteúdo dentro do 7z"), erro: "" };
      },
    };
    const sevenZ = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), Buffer.alloc(64)]);
    const r = await extrair(sevenZ, { nome: "pacote.7z", seteZip: sete });
    expect(r.texto).toContain("Conteúdo dentro do 7z");
    expect(chamadas[1]!.slice(0, 2)).toEqual(["e", "-so"]);
    // o único arquivo em disco é o compactado, só para o dono do processo
    expect(writeFile.mock.calls[0]![2]).toMatchObject({ mode: 0o600 });
    const sem = await extrair(sevenZ, { nome: "pacote.7z", seteZip: null });
    expect(sem.resumo).toMatch(/precisa do 7-Zip/);
  });

  it("senha errada no 7-Zip vira 'protegido', sem repetir a senha", async () => {
    const sete: SeteZip = { rodar: async () => ({ codigo: 2, saida: Buffer.alloc(0), erro: "ERROR: Wrong password : nota.txt" }) };
    const rar = Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), Buffer.alloc(64)]);
    const r = await extrair(rar, { nome: "x.rar", senhas: ["segredo-do-banco"], seteZip: sete });
    expect(r.protegido).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain("segredo-do-banco");
  });
});
