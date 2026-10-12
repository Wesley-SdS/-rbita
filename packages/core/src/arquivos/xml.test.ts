import { describe, expect, it } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import { atributo, textoDoSlide, textoOdf, tokens } from "./xml";
import { lerOdt } from "./leitores/office";
import { lerNfe } from "./leitores/estruturado";
import { tituloDoHtml } from "./leitores/email";
import type { Limites } from "./tipos";

/**
 * B5 da revisão de segurança (11/10/2026): um ODT de 470 bytes que infla para
 * `<a<a<a…` levava 19 s no tokenizador de XML, com o laço de eventos parado
 * (chat, WhatsApp e scheduler juntos). Aqui o arquivo patológico tem de sair
 * em menos de 1 s, e o laço tem de continuar girando enquanto ele é lido.
 */

const LIMITES: Limites = { linhasMax: 2000, zipMaxArquivos: 200, zipMaxBytes: 500 * 1024 * 1024, zipProfundidade: 3, arquivoMaxBytes: 50 * 1024 * 1024, transcreverAudio: false, quadrosDoVideo: 0, seteZip: "", textoMax: 2_000_000 };

/** Roda `fn` medindo o tempo e o maior intervalo entre dois tiques de um relógio de 10 ms (o laço parado aparece aqui). */
async function medir<T>(fn: () => Promise<T> | T): Promise<{ ms: number; maiorPausaMs: number; r: T }> {
  let ultimo = Date.now();
  let maiorPausaMs = 0;
  const relogio = setInterval(() => {
    const agora = Date.now();
    maiorPausaMs = Math.max(maiorPausaMs, agora - ultimo);
    ultimo = agora;
  }, 10);
  const inicio = Date.now();
  try {
    const r = await fn();
    // a pausa que termina junto com a função só é vista no próximo tique
    await new Promise((ok) => setTimeout(ok, 30));
    return { ms: Date.now() - inicio, maiorPausaMs: Math.max(maiorPausaMs, Date.now() - ultimo), r };
  } finally {
    clearInterval(relogio);
  }
}

/** Um ZIP mínimo (deflate), sem biblioteca: o bastante para o leitor de ODT abrir. */
function zipMinimo(arquivos: Record<string, string>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = Buffer.from(conteudo, "utf8");
    const comp = deflateRawSync(dados);
    const n = Buffer.from(nome, "utf8");
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(pos, 42);
    locais.push(local, n, comp);
    centrais.push(central, n);
    pos += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(Object.keys(arquivos).length, 8); fim.writeUInt16LE(Object.keys(arquivos).length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, cd, fim]);
}

function odtPatologico(): Buffer {
  return zipMinimo({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": '<?xml version="1.0"?><office:document-content><office:body><office:text><text:p>oi</text:p></office:text></office:body></office:document-content>' + "<a".repeat(60000),
  });
}

describe("XML sem custo quadrático (B5)", () => {
  it("o ODT patológico da revisão (menos de 1 KB) sai em menos de 1 s, sem parar o laço", async () => {
    const odt = odtPatologico();
    expect(odt.length).toBeLessThan(1024);
    const m = await medir(() => lerOdt(odt, LIMITES, { bytes: LIMITES.zipMaxBytes, arquivos: 200 }));
    expect(m.ms).toBeLessThan(1000);
    expect(m.maiorPausaMs).toBeLessThan(500);
    // e o texto legítimo de antes do lixo continua lido (controle)
    expect(m.r.texto).toContain("oi");
  });

  it("o tokenizador é linear: 20 vezes mais lixo não leva 400 vezes mais tempo", async () => {
    const pequeno = await medir(() => [...tokens("<a".repeat(10_000))].length);
    const grande = await medir(() => [...tokens("<a".repeat(200_000))].length);
    expect(grande.ms).toBeLessThan(1000);
    expect(grande.ms).toBeLessThan(Math.max(50, pequeno.ms) * 60);
    expect((await medir(() => textoOdf("<office:text>" + "<a".repeat(200_000)))).ms).toBeLessThan(1000);
  });

  it("slide do PowerPoint com tabela sem fechamento repetida não trava", async () => {
    const m = await medir(() => textoDoSlide("<a:tbl>".repeat(100_000) + "<p:sp ".repeat(50_000) + "<a:tr ".repeat(50_000)));
    expect(m.ms).toBeLessThan(1000);
  });

  it("NF-e, título de MHT e atributo patológicos não travam", async () => {
    const nfe = await medir(() => lerNfe("<det ".repeat(30_000) + "<det>".repeat(30_000) + "<emit>".repeat(30_000)));
    expect(nfe.ms).toBeLessThan(1000);
    expect((await medir(() => tituloDoHtml("<title".repeat(200_000)))).ms).toBeLessThan(1000);
    expect((await medir(() => atributo('type="'.repeat(200_000), "type"))).ms).toBeLessThan(1000);
  });

  it("o XML de verdade continua lido igual (controle)", () => {
    const slide =
      '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Orçamento &amp; prazo</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>' +
      "<p:sp><p:txBody><a:p><a:r><a:t>linha 1</a:t></a:r><a:br/><a:r><a:t>linha 2</a:t></a:r></a:p></p:txBody></p:sp>" +
      "<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Item</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Valor</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Luz</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>90</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame></p:spTree></p:cSld></p:sld>";
    const s = textoDoSlide(slide);
    expect(s.tabelas).toBe(1);
    expect(s.texto.split("\n").slice(0, 2)).toEqual(["Orçamento & prazo", "linha 1\nlinha 2".split("\n")[0]]);
    expect(s.texto).toContain("linha 2");
    expect(s.texto).not.toMatch(/^7$/m);
    expect(s.texto).toContain("| Luz | 90 |");
    expect(atributo(' draw:name="Slide &amp; 1" x="2"', "draw:name")).toBe("Slide & 1");
    expect(tituloDoHtml("<html><head><TITLE>Contrato de aluguel</TITLE></head>")).toBe("Contrato de aluguel");
    const nota = lerNfe(
      '<nfeProc><NFe><infNFe Id="NFe35261012345678000199550010000012341000012345"><ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>Mercado Bom</xNome></emit>' +
        "<det nItem=\"1\"><prod><xProd>Arroz</xProd><qCom>2</qCom><uCom>UN</uCom><vUnCom>10.50</vUnCom><vProd>21.00</vProd></prod></det><total><ICMSTot><vNF>21.00</vNF></ICMSTot></total><pag><detPag><vPag>21.00</vPag></detPag></pag></infNFe></NFe></nfeProc>",
    );
    expect(nota).toMatchObject({ emitente: "Mercado Bom", cnpj: "12345678000199", numero: "1234", serie: "1", data: "2026-10-01", valorTotal: 21, itens: [{ descricao: "Arroz", quantidade: 2, unidade: "UN", valorUnitario: 10.5, valorTotal: 21 }] });
  });
});

describe("o contêiner Office não guarda tudo inflado na memória (O6 da revisão)", () => {
  it("conta toda entrada no orçamento, mas só guarda o XML que o leitor usa", async () => {
    const { conteudoDoContainer } = await import("./leitores/office");
    const midia = "x".repeat(200_000);
    const zip = zipMinimo({ "content.xml": "<office:text><text:p>oi</text:p></office:text>", "Pictures/foto.png": midia, "META-INF/manifest.xml": "<m/>" });
    const orcamento = { bytes: 10_000_000, arquivos: 200 };
    const c = await conteudoDoContainer(zip, LIMITES, orcamento);
    expect([...c.keys()].sort()).toEqual(["META-INF/manifest.xml", "content.xml"]);
    // a mídia foi inflada e contada (a bomba continua sendo pega), só não ficou guardada
    expect(10_000_000 - orcamento.bytes).toBeGreaterThanOrEqual(midia.length);
    const nada = await conteudoDoContainer(zip, LIMITES, { bytes: 10_000_000, arquivos: 200 }, () => false);
    expect(nada.size).toBe(0);
    await expect(conteudoDoContainer(zip, LIMITES, { bytes: 1000, arquivos: 200 })).rejects.toThrow();
  });
});
